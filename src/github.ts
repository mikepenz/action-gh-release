import * as core from '@actions/core'
import {getOctokit} from '@actions/github'
import {alignAssetName, Config, errorMessage, isTag, normalizeTagName, releaseBody} from './util.js'
import {statSync} from 'fs'
import {open, type FileHandle} from 'fs/promises'
import {lookup} from 'mime-types'
import {basename} from 'path'

type NewGitHub = ReturnType<typeof getOctokit>

type UploadChunk = ArrayBuffer | Uint8Array<ArrayBufferLike>

// `readableWebStream()` can yield raw ArrayBuffers, which undici refuses to send as a
// request body — small assets (checksums, signatures) end up uploaded empty.
const fileUploadStream = (fileHandle: FileHandle): ReadableStream<Uint8Array<ArrayBufferLike>> => {
  const source = fileHandle.readableWebStream() as ReadableStream<UploadChunk>
  return source.pipeThrough(
    new TransformStream<UploadChunk, Uint8Array<ArrayBufferLike>>({
      transform(chunk, controller) {
        controller.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
      }
    })
  )
}

// Errors reaching us are not guaranteed to be Octokit errors — a thrown string or null
// would blow up on a plain `error.status` read.
export const errorStatus = (error: unknown): number | undefined => {
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined
  if (typeof record?.status === 'number') {
    return record.status
  }
  const response = record?.response
  const responseRecord =
    typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : undefined
  return typeof responseRecord?.status === 'number' ? responseRecord.status : undefined
}

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

  deleteRelease(params: {owner: string; repo: string; release_id: number}): Promise<unknown>

  allReleases(params: {owner: string; repo: string}): AsyncIterable<{data: Release[]}>
}

// Repositories with immutable releases enabled reject asset uploads once the release is
// published — the assets have to be in place while it is still a draft.
const isImmutableReleaseAssetUploadFailure = (error: unknown): boolean => {
  const record = typeof error === 'object' && error !== null ? (error as any) : undefined
  const message = record?.response?.data?.message ?? record?.message
  return errorStatus(error) === 422 && /immutable release/i.test(String(message))
}

const immutableReleaseAssetUploadMessage = (name: string, config: Config): string => {
  const base = `Cannot upload asset ${name} to an immutable release. GitHub only allows asset uploads before a release is published.`
  if (config.input_prerelease) {
    return `${base} Draft prereleases publish with the release.published event instead of release.prereleased, so set draft: true to keep the release a draft, publish it later from that draft, and subscribe downstream workflows to release.published.`
  }
  if (config.input_draft_during_upload === false) {
    return `${base} Remove draft_during_upload: false so the release stays a draft until its assets are uploaded.`
  }
  return `${base} Upload assets to a draft release before you publish it.`
}

// GitHub rejects publishing a draft when another release already claims the tag,
// which happens when a concurrent job created the release while we were uploading.
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export const isTagConflict = (error: any): boolean => {
  const status = errorStatus(error)
  const errors = error?.response?.data?.errors ?? error?.errors
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return status === 422 && !!errors?.some((e: any) => e.code === 'already_exists' && e.field === 'tag_name')
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

  async deleteRelease(params: {owner: string; repo: string; release_id: number}): Promise<unknown> {
    return await this.github.rest.repos.deleteRelease(params)
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
      if (errorStatus(err) !== 404) {
        throw err
      }
      // Gitea only serves the release-scoped delete endpoint, so a 404 here may mean
      // "wrong endpoint" rather than "already gone". Retry before giving up.
      if (releaseId === undefined) {
        return
      }
      try {
        await github.request('DELETE /repos/{owner}/{repo}/releases/{release_id}/assets/{asset_id}', {
          owner,
          repo,
          release_id: releaseId,
          asset_id
        })
      } catch (fallbackErr: any) {
        // 404 on both endpoints means another workflow already deleted it — safe to ignore.
        if (errorStatus(fallbackErr) === 404) {
          return
        }
        throw new AggregateError(
          [err, fallbackErr],
          `Failed to delete release asset ${asset_id}. GitHub endpoint: ${errorMessage(err)}; release-scoped endpoint: ${errorMessage(fallbackErr)}`
        )
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
        data: fileUploadStream(fh)
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
    const status = errorStatus(error)
    const errorData = error?.response?.data

    // Retrying can never succeed while the release is published, so report the
    // misconfiguration instead of the raw 422.
    if (isImmutableReleaseAssetUploadFailure(error)) {
      const message = immutableReleaseAssetUploadMessage(name, config)
      if (config.input_fail_on_asset_upload_issue) {
        throw new Error(message)
      }
      core.error(message)
      return null
    }

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

// Releases are listed newest first, so a draft awaiting its tag shows up on the first
// pages. Bounding the scan keeps the fallback cheap on repositories with many releases.
const RECENT_RELEASE_SCAN_PAGES = 2

export const findTagFromReleases = async (
  releaser: Releaser,
  owner: string,
  repo: string,
  tag: string,
  maxPages = RECENT_RELEASE_SCAN_PAGES
): Promise<Release | undefined> => {
  let pages = 0
  for await (const {data: releases} of releaser.allReleases({owner, repo})) {
    const rel = releases.find(r => r.tag_name === tag)
    if (rel) {
      return rel
    }
    if (++pages >= maxPages) {
      break
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
  // Uploading into a draft keeps the release hidden until the assets are there, at the
  // cost of a long window in which a concurrent job can claim the tag. Creating it
  // published up front shrinks that window to this single call, which already recovers
  // from `already_exists` below.
  const draft = config.input_draft === true || config.input_draft_during_upload
  console.log(`👩‍🏭 Creating new GitHub release for tag ${tag_name}${commitMessage}...`)
  try {
    const rel = await releaser.createRelease({
      owner,
      repo,
      tag_name,
      name,
      body,
      draft,
      prerelease,
      target_commitish,
      discussion_category_name,
      generate_release_notes,
      make_latest,
      previous_tag_name
    })
    return rel.data
  } catch (error: any) {
    const status = errorStatus(error)
    console.log(`⚠️ GitHub release failed with status: ${status}`)
    console.log(`${JSON.stringify(error?.response?.data) ?? errorMessage(error)}`)

    switch (status) {
      case 403:
        console.log('Skip retry — your GitHub token/PAT does not have the required permission to create a release')
        throw error
      case 404: {
        const discussionGuidance = discussion_category_name
          ? ` Also verify that Discussions and the requested category "${discussion_category_name}" are enabled.`
          : ''
        console.log(
          `Skip retry — GitHub returned 404 while creating the release. Verify that ${owner}/${repo} exists under the expected owner, the token can access it, the repository is selected when using a fine-grained PAT, and the token has Contents: write permission.${discussionGuidance} GitHub response: ${errorMessage(error)}`
        )
        throw error
      }
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
// Returns undefined when no release matches, so the caller can create a new one.
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
    if (errorStatus(error) !== 404) {
      throw error
    }
    // GitHub does not expose draft releases through getReleaseByTag, so a 404 falls
    // back to a bounded listing scan to pick up a draft awaiting this tag.
    return await findTagFromReleases(releaser, owner, repo, tag)
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
    if (errorStatus(error) !== 404) {
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
    // A concurrent job published a release for this tag while we were uploading.
    // Retrying can never succeed, so either fail fast or adopt the existing release.
    if (isTagConflict(error)) {
      if (config.input_on_tag_conflict === 'fail') {
        console.log(`❌ Another release already claims tag ${rel.tag_name} and on_tag_conflict is "fail"`)
        throw error
      }
      console.log(`⚠️ Another release already claims tag ${rel.tag_name}; updating that release instead...`)
      await releaser
        .deleteRelease({owner, repo, release_id: rel.id})
        .catch(err => console.warn(`⚠️ Failed to clean up draft release ${rel.id}: ${err}`))
      return await release(config, releaser)
    }

    console.warn(`error finalizing release: ${error}`)
    console.log(`retrying... (${maxRetries - 1} retries remaining)`)
    return finalizeRelease(config, releaser, rel, maxRetries - 1)
  }
}
