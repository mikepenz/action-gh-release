import * as core from '@actions/core'
import {getOctokit} from '@actions/github'
import {alignAssetName, Config, isTag, normalizeTagName, releaseBody} from './util.js'
import {statSync} from 'fs'
import {open} from 'fs/promises'
import {lookup} from 'mime-types'
import {basename} from 'path'

type NewGitHub = ReturnType<typeof getOctokit>

export interface ReleaseAsset {
  name: string
  mime: string
  size: number
}

export interface Release {
  id: number
  upload_url: string
  html_url: string
  tag_name: string
  name: string | null
  body?: string | null | undefined
  target_commitish: string
  draft: boolean
  prerelease: boolean
  assets: {id: number; name: string}[]
}

export interface Releaser {
  getReleaseByTag(params: {owner: string; repo: string; tag: string}): Promise<{data: Release}>

  createRelease(params: {
    owner: string
    repo: string
    tag_name: string
    name: string
    body: string | undefined
    draft: boolean | undefined
    prerelease: boolean | undefined
    target_commitish: string | undefined
    discussion_category_name: string | undefined
    generate_release_notes: boolean | undefined
    make_latest: 'true' | 'false' | 'legacy' | undefined
    previous_tag_name?: string
  }): Promise<{data: Release}>

  updateRelease(params: {
    owner: string
    repo: string
    release_id: number
    tag_name: string
    target_commitish: string
    name: string
    body: string | undefined
    draft: boolean | undefined
    prerelease: boolean | undefined
    discussion_category_name: string | undefined
    generate_release_notes: boolean | undefined
    make_latest: 'true' | 'false' | 'legacy' | undefined
    previous_tag_name?: string
  }): Promise<{data: Release}>

  finalizeRelease(params: {owner: string; repo: string; release_id: number}): Promise<{data: Release}>

  allReleases(params: {owner: string; repo: string}): AsyncIterable<{data: Release[]}>
}

export class GitHubReleaser implements Releaser {
  github: NewGitHub
  constructor(github: NewGitHub) {
    this.github = github
  }

  getReleaseByTag(params: {owner: string; repo: string; tag: string}): Promise<{data: Release}> {
    return this.github.rest.repos.getReleaseByTag(params)
  }

  async getReleaseNotes(params: {
    owner: string
    repo: string
    tag_name: string
    target_commitish: string | undefined
    previous_tag_name?: string
  }): Promise<{data: {name: string; body: string}}> {
    return await this.github.rest.repos.generateReleaseNotes(params)
  }

  truncateReleaseNotes(input: string): string {
    // release notes can be a maximum of 125000 characters
    const githubNotesMaxCharLength = 125000
    return input.substring(0, githubNotesMaxCharLength - 1)
  }

  async createRelease(params: {
    owner: string
    repo: string
    tag_name: string
    name: string
    body: string | undefined
    draft: boolean | undefined
    prerelease: boolean | undefined
    target_commitish: string | undefined
    discussion_category_name: string | undefined
    generate_release_notes: boolean | undefined
    make_latest: 'true' | 'false' | 'legacy' | undefined
    previous_tag_name?: string
  }): Promise<{data: Release}> {
    if (typeof params.make_latest === 'string' && !['true', 'false', 'legacy'].includes(params.make_latest)) {
      params.make_latest = undefined
    }
    if (params.generate_release_notes) {
      const releaseNotes = await this.getReleaseNotes({
        owner: params.owner,
        repo: params.repo,
        tag_name: params.tag_name,
        target_commitish: params.target_commitish,
        previous_tag_name: params.previous_tag_name
      })
      params.generate_release_notes = false
      if (params.body) {
        params.body = `${params.body}\n\n${releaseNotes.data.body}`
      } else {
        params.body = releaseNotes.data.body
      }
    }
    params.body = params.body ? this.truncateReleaseNotes(params.body) : undefined
    const {previous_tag_name, ...createParams} = params
    return this.github.rest.repos.createRelease(createParams)
  }

  async updateRelease(params: {
    owner: string
    repo: string
    release_id: number
    tag_name: string
    target_commitish: string
    name: string
    body: string | undefined
    draft: boolean | undefined
    prerelease: boolean | undefined
    discussion_category_name: string | undefined
    generate_release_notes: boolean | undefined
    make_latest: 'true' | 'false' | 'legacy' | undefined
    previous_tag_name?: string
  }): Promise<{data: Release}> {
    if (typeof params.make_latest === 'string' && !['true', 'false', 'legacy'].includes(params.make_latest)) {
      params.make_latest = undefined
    }
    if (params.generate_release_notes) {
      const releaseNotes = await this.getReleaseNotes({
        owner: params.owner,
        repo: params.repo,
        tag_name: params.tag_name,
        target_commitish: params.target_commitish,
        previous_tag_name: params.previous_tag_name
      })
      params.generate_release_notes = false
      if (params.body) {
        params.body = `${params.body}\n\n${releaseNotes.data.body}`
      } else {
        params.body = releaseNotes.data.body
      }
    }
    params.body = params.body ? this.truncateReleaseNotes(params.body) : undefined
    const {previous_tag_name, ...updateParams} = params
    return this.github.rest.repos.updateRelease(updateParams)
  }

  async finalizeRelease(params: {owner: string; repo: string; release_id: number}): Promise<{data: Release}> {
    return await this.github.rest.repos.updateRelease({
      owner: params.owner,
      repo: params.repo,
      release_id: params.release_id,
      draft: false
    })
  }

  allReleases(params: {owner: string; repo: string}): AsyncIterable<{data: Release[]}> {
    const updatedParams = {per_page: 100, ...params}
    return this.github.paginate.iterator(this.github.rest.repos.listReleases.endpoint.merge(updatedParams))
  }
}

export const asset = (path: string): ReleaseAsset => {
  return {
    name: basename(path),
    mime: mimeOrDefault(path),
    size: statSync(path).size
  }
}

export const mimeOrDefault = (path: string): string => {
  return lookup(path) || 'application/octet-stream'
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const upload = async (
  config: Config,
  github: NewGitHub,
  url: string,
  path: string,
  currentAssets: {id: number; name: string}[]
): Promise<any> => {
  const [owner, repo] = config.github_repository.split('/')
  const {name, mime, size} = asset(path)
  // Extract the release id from the upload URL so we can refresh asset
  // listings when a concurrent workflow has changed them out from under us.
  const releaseIdMatch = url.match(/\/releases\/(\d+)\/assets/)
  const releaseId = releaseIdMatch ? Number(releaseIdMatch[1]) : undefined

  const matchesName = (a: {name: string}): boolean => a.name === name || a.name === alignAssetName(name)

  const deleteIfPresent = async (asset_id: number) => {
    try {
      await github.rest.repos.deleteReleaseAsset({asset_id, owner, repo})
    } catch (err: any) {
      // 404 means another workflow already deleted it — safe to ignore.
      if (err?.status !== 404) {
        throw err
      }
    }
  }

  const existing = currentAssets.find(matchesName)
  if (existing) {
    if (config.input_overwrite_files === false) {
      console.log(`Asset ${name} already exists and overwrite_files is false...`)
      return null
    } else {
      console.log(`♻️ Deleting previously uploaded asset ${name}...`)
      await deleteIfPresent(existing.id || 1)
    }
  }
  console.log(`⬆️ Uploading ${name}...`)
  const endpoint = new URL(url)
  endpoint.searchParams.append('name', name)

  const doUpload = async () => {
    const fh = await open(path)
    try {
      return await github.request({
        method: 'POST',
        url: endpoint.toString(),
        headers: {
          'content-length': `${size}`,
          'content-type': mime,
          authorization: `token ${config.github_token}`
        },
        data: fh.readableWebStream()
      })
    } finally {
      await fh.close()
    }
  }

  try {
    let resp = await doUpload()
    let json = resp.data
    if (resp.status !== 201) {
      throw new Error(
        `Failed to upload release asset ${name}. received status code ${resp.status}\n${json.message}\n${JSON.stringify(json.errors)}`
      )
    }
    console.log(`✅ Uploaded ${name}`)
    return json
  } catch (error: any) {
    const status = error?.status ?? error?.response?.status
    const errorData = error?.response?.data

    // Race condition recovery: another workflow uploaded the same asset
    // between our delete and our upload (or no prior asset existed and one
    // appeared concurrently). Refresh the asset list, delete, retry once.
    if (
      config.input_overwrite_files !== false &&
      status === 422 &&
      errorData?.errors?.[0]?.code === 'already_exists' &&
      releaseId !== undefined
    ) {
      console.log(`⚠️ Asset ${name} already exists (race condition); refreshing assets and retrying once...`)
      try {
        const latest = await github.paginate(github.rest.repos.listReleaseAssets, {
          owner,
          repo,
          release_id: releaseId,
          per_page: 100
        })
        const collision = (latest as {id: number; name: string}[]).find(matchesName)
        if (collision) {
          await deleteIfPresent(collision.id)
          const resp = await doUpload()
          if (resp.status === 201) {
            console.log(`✅ Uploaded ${name}`)
            return resp.data
          }
        }
      } catch (refreshError) {
        console.warn(`Race-condition recovery failed for ${name}: ${refreshError}`)
      }
    }

    if (config.input_fail_on_asset_upload_issue) {
      throw error
    }
    core.error(`Failed to upload asset ${name}. Received error: ${error}`)
    return null
  }
}

export const findTagFromReleases = async (
  releaser: Releaser,
  owner: string,
  repo: string,
  tag: string
): Promise<Release | undefined> => {
  for await (const {data: releases} of releaser.allReleases({owner, repo})) {
    const rel = releases.find(r => r.tag_name === tag)
    if (rel) {
      return rel
    }
  }
  return undefined
}

const createNewRelease = async (
  tag: string,
  config: Config,
  releaser: Releaser,
  owner: string,
  repo: string,
  discussion_category_name: string | undefined,
  generate_release_notes: boolean | undefined,
  previous_tag_name: string | undefined,
  maxRetries: number
): Promise<Release> => {
  const tag_name = tag
  const name = config.input_name || tag
  const body = releaseBody(config)
  const prerelease = config.input_prerelease
  const target_commitish = config.input_target_commitish
  const make_latest = config.input_make_latest
  let commitMessage = ''
  if (target_commitish) {
    commitMessage = ` using commit "${target_commitish}"`
  }
  console.log(`👩‍🏭 Creating new GitHub release for tag ${tag_name}${commitMessage}...`)
  try {
    const rel = await releaser.createRelease({
      owner,
      repo,
      tag_name,
      name,
      body,
      draft: true,
      prerelease,
      target_commitish,
      discussion_category_name,
      generate_release_notes,
      make_latest,
      previous_tag_name
    })
    return rel.data
  } catch (error: any) {
    console.log(`⚠️ GitHub release failed with status: ${error.status}`)
    console.log(`${JSON.stringify(error.response?.data)}`)

    switch (error.status) {
      case 403:
        console.log('Skip retry — your GitHub token/PAT does not have the required permission to create a release')
        throw error
      case 404:
        console.log('Skip retry - discussion category mismatch')
        throw error
      case 422: {
        const errorData = error.response?.data
        if (errorData?.errors?.[0]?.code === 'already_exists') {
          console.log(
            '⚠️ Release already exists (race condition detected), retrying to find and update existing release...'
          )
        } else {
          console.log('Skip retry - validation failed')
          throw error
        }
        break
      }
    }

    console.log(`retrying... (${maxRetries - 1} retries remaining)`)
    return release(config, releaser, maxRetries - 1)
  }
}

// Eagerly look up a release by its tag using the dedicated GitHub API endpoint.
// Falls back to undefined on 404 so the caller can create a new release.
const getReleaseByTagOrUndefined = async (
  releaser: Releaser,
  owner: string,
  repo: string,
  tag: string
): Promise<Release | undefined> => {
  try {
    const {data} = await releaser.getReleaseByTag({owner, repo, tag})
    return data
  } catch (error: any) {
    if (error?.status === 404) {
      return undefined
    }
    // For drafts (which have no tag yet), getReleaseByTag may not find them.
    // Fall back to the legacy pagination-based lookup so existing drafts
    // matching the tag name are still found.
    try {
      return await findTagFromReleases(releaser, owner, repo, tag)
    } catch {
      throw error
    }
  }
}

export const release = async (config: Config, releaser: Releaser, maxRetries = 3): Promise<Release> => {
  if (maxRetries <= 0) {
    core.error(`❌ Too many retries. Aborting...`)
    throw new Error('Too many retries.')
  }

  const [owner, repo] = config.github_repository.split('/')
  const tag =
    normalizeTagName(config.input_tag_name) ||
    (isTag(config.github_ref) ? config.github_ref.replace('refs/tags/', '') : '')

  const discussion_category_name = config.input_discussion_category_name
  const generate_release_notes = config.input_generate_release_notes
  const previous_tag_name = config.input_previous_tag

  if (generate_release_notes && previous_tag_name) {
    console.log(`📝 Generating release notes using previous tag ${previous_tag_name}`)
  }
  try {
    // Fast path: direct getReleaseByTag instead of paginating all releases.
    // Falls back to pagination internally for draft-without-tag scenarios.
    const existingRelease = await getReleaseByTagOrUndefined(releaser, owner, repo, tag)

    if (existingRelease === undefined) {
      return await createNewRelease(
        tag,
        config,
        releaser,
        owner,
        repo,
        discussion_category_name,
        generate_release_notes,
        previous_tag_name,
        maxRetries
      )
    }

    console.log(`Found release ${existingRelease.name} (with id=${existingRelease.id})`)

    const release_id = existingRelease.id
    let target_commitish: string
    if (config.input_target_commitish && config.input_target_commitish !== existingRelease.target_commitish) {
      console.log(`Updating commit from "${existingRelease.target_commitish}" to "${config.input_target_commitish}"`)
      target_commitish = config.input_target_commitish
    } else {
      target_commitish = existingRelease.target_commitish
    }

    const tag_name = tag
    const name = config.input_name || existingRelease.name || tag
    const workflowBody = releaseBody(config) || ''
    const existingReleaseBody = existingRelease.body || ''
    let body: string
    if (config.input_append_body && workflowBody && existingReleaseBody) {
      body = `${existingReleaseBody}\n${workflowBody}`
    } else {
      body = workflowBody || existingReleaseBody
    }

    const prerelease = config.input_prerelease !== undefined ? config.input_prerelease : existingRelease.prerelease
    const make_latest = config.input_make_latest

    const rel = await releaser.updateRelease({
      owner,
      repo,
      release_id,
      tag_name,
      target_commitish,
      name,
      body,
      draft: config.input_draft !== undefined ? config.input_draft : existingRelease.draft,
      prerelease,
      discussion_category_name,
      generate_release_notes,
      make_latest,
      previous_tag_name
    })
    return rel.data
  } catch (error: any) {
    if (error.status !== 404) {
      console.log(`⚠️ Unexpected error fetching GitHub release for tag ${config.github_ref}: ${error}`)
      throw error
    }

    return await createNewRelease(
      tag,
      config,
      releaser,
      owner,
      repo,
      discussion_category_name,
      generate_release_notes,
      previous_tag_name,
      maxRetries
    )
  }
}

export const finalizeRelease = async (
  config: Config,
  releaser: Releaser,
  rel: Release,
  maxRetries = 3
): Promise<Release> => {
  // If user explicitly wants a draft, or the release is already published, nothing to do
  if (config.input_draft === true || !rel.draft) {
    return rel
  }

  if (maxRetries <= 0) {
    console.log(`❌ Too many retries. Aborting...`)
    throw new Error('Too many retries.')
  }

  const [owner, repo] = config.github_repository.split('/')
  try {
    const {data} = await releaser.finalizeRelease({
      owner,
      repo,
      release_id: rel.id
    })
    return data
  } catch (error) {
    console.warn(`error finalizing release: ${error}`)
    console.log(`retrying... (${maxRetries - 1} retries remaining)`)
    return finalizeRelease(config, releaser, rel, maxRetries - 1)
  }
}
