import * as core from '@actions/core'
import {getOctokit} from '@actions/github'
import {alignAssetName, Config, isTag, releaseBody} from './util.js'
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
  }): Promise<{data: Release}> {
    if (typeof params.make_latest === 'string' && !['true', 'false', 'legacy'].includes(params.make_latest)) {
      params.make_latest = undefined
    }
    if (params.generate_release_notes) {
      const releaseNotes = await this.getReleaseNotes(params)
      params.generate_release_notes = false
      if (params.body) {
        params.body = `${params.body}\n\n${releaseNotes.data.body}`
      } else {
        params.body = releaseNotes.data.body
      }
    }
    params.body = params.body ? this.truncateReleaseNotes(params.body) : undefined
    return this.github.rest.repos.createRelease(params)
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
  }): Promise<{data: Release}> {
    if (typeof params.make_latest === 'string' && !['true', 'false', 'legacy'].includes(params.make_latest)) {
      params.make_latest = undefined
    }
    if (params.generate_release_notes) {
      const releaseNotes = await this.getReleaseNotes(params)
      params.generate_release_notes = false
      if (params.body) {
        params.body = `${params.body}\n\n${releaseNotes.data.body}`
      } else {
        params.body = releaseNotes.data.body
      }
    }
    params.body = params.body ? this.truncateReleaseNotes(params.body) : undefined
    return this.github.rest.repos.updateRelease(params)
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
  const currentAsset = currentAssets.find(
    // GitHub renames asset filenames with special characters; compare against the renamed version
    ({name: currentName}) => currentName === alignAssetName(name)
  )
  if (currentAsset) {
    if (config.input_overwrite_files === false) {
      console.log(`Asset ${name} already exists and overwrite_files is false...`)
      return null
    } else {
      console.log(`♻️ Deleting previously uploaded asset ${name}...`)
      await github.rest.repos.deleteReleaseAsset({
        asset_id: currentAsset.id || 1,
        owner,
        repo
      })
    }
  }
  console.log(`⬆️ Uploading ${name}...`)
  const endpoint = new URL(url)
  endpoint.searchParams.append('name', name)
  const fh = await open(path)
  try {
    const resp = await github.request({
      method: 'POST',
      url: endpoint.toString(),
      headers: {
        'content-length': `${size}`,
        'content-type': mime,
        authorization: `token ${config.github_token}`
      },
      data: fh.readableWebStream({type: 'bytes'})
    })
    const json = resp.data
    if (resp.status !== 201) {
      throw new Error(
        `Failed to upload release asset ${name}. received status code ${resp.status}\n${json.message}\n${JSON.stringify(json.errors)}`
      )
    }
    console.log(`✅ Uploaded ${name}`)
    return json
  } catch (error) {
    if (config.input_fail_on_asset_upload_issue) {
      throw error
    }
    core.error(`Failed to upload asset ${name}. Received error: ${error}`)
    return null
  } finally {
    await fh.close()
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
      make_latest
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

export const release = async (config: Config, releaser: Releaser, maxRetries = 3): Promise<Release> => {
  if (maxRetries <= 0) {
    core.error(`❌ Too many retries. Aborting...`)
    throw new Error('Too many retries.')
  }

  const [owner, repo] = config.github_repository.split('/')
  const tag = config.input_tag_name || (isTag(config.github_ref) ? config.github_ref.replace('refs/tags/', '') : '')

  const discussion_category_name = config.input_discussion_category_name
  const generate_release_notes = config.input_generate_release_notes
  try {
    const existingRelease = await findTagFromReleases(releaser, owner, repo, tag)

    if (existingRelease === undefined) {
      return await createNewRelease(
        tag,
        config,
        releaser,
        owner,
        repo,
        discussion_category_name,
        generate_release_notes,
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
      make_latest
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
