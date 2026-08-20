import * as core from '@actions/core'
import {paths, parseConfig, isTag, unmatchedPatterns, uploadUrl} from './util.js'
import {release, upload, finalizeRelease, GitHubReleaser, Release} from './github.js'
import {getOctokit} from '@actions/github'

import {env} from 'process'

async function run(): Promise<void> {
  try {
    const config = parseConfig(env)
    if (!config.input_tag_name && !isTag(config.github_ref) && !config.input_draft) {
      throw new Error(`⚠️ GitHub Releases requires a tag`)
    }
    if (config.input_files) {
      const patterns = unmatchedPatterns(config.input_files, config.input_working_directory)
      for (const pattern of patterns) {
        if (config.input_fail_on_unmatched_files) {
          throw new Error(`⚠️  Pattern '${pattern}' does not match any files.`)
        } else {
          core.warning(`🤔 Pattern '${pattern}' does not match any files.`)
        }
      }
      if (patterns.length > 0 && config.input_fail_on_unmatched_files) {
        throw new Error(`⚠️ There were unmatched files`)
      }
    }

    const gh = getOctokit(config.github_token, {
      throttle: {
        onRateLimit: (retryAfter, options) => {
          core.warning(`Request quota exhausted for request ${options.method} ${options.url}`)
          if (options.request.retryCount === 0) {
            core.info(`Retrying after ${retryAfter} seconds!`)
            return true
          }
        },
        onAbuseLimit: (retryAfter, options) => {
          core.warning(`Abuse detected for request ${options.method} ${options.url}`)
        }
      }
    })
    const releaser = new GitHubReleaser(gh)
    let rel = await release(config, releaser)

    const uploadAssets = async (target: Release) => {
      if (!config.input_files || config.input_files.length === 0) {
        return
      }
      const files = paths(config.input_files, config.input_working_directory)
      if (files.length === 0) {
        if (config.input_fail_on_unmatched_files) {
          throw new Error(`⚠️ ${config.input_files} not include valid file.`)
        } else {
          core.warning(`🤔 ${config.input_files} not include valid file.`)
        }
      }
      const currentAssets = target.assets

      const uploadFile = async (path: string) => {
        const json = await upload(config, gh, uploadUrl(target.upload_url), path, currentAssets)
        if (json) {
          delete json.uploader
        }
        return json
      }

      let results: (any | null)[]
      if (config.input_preserve_order) {
        results = []
        for (const path of files) {
          results.push(await uploadFile(path))
        }
      } else {
        const concurrency = Math.max(1, Math.min(config.input_concurrency, files.length || 1))
        results = new Array(files.length)
        let nextIndex = 0
        const worker = async () => {
          while (true) {
            const i = nextIndex++
            if (i >= files.length) return
            results[i] = await uploadFile(files[i])
          }
        }
        await Promise.all(Array.from({length: concurrency}, () => worker()))
      }

      const assets = results.filter(Boolean)
      core.setOutput('assets', assets)
    }

    await uploadAssets(rel)

    console.log('Finalizing release...')
    const finalizedFrom = rel.id
    rel = await finalizeRelease(config, releaser, rel)
    if (rel.id !== finalizedFrom) {
      // on_tag_conflict=update switched us to a release created by another job,
      // so our assets have to be uploaded again onto it.
      await uploadAssets(rel)
      rel = await finalizeRelease(config, releaser, rel)
    }

    core.info(`🎉 Release ready at ${rel.html_url}`)
    core.setOutput('url', rel.html_url)
    core.setOutput('id', rel.id.toString())
    core.setOutput('upload_url', rel.upload_url)
  } catch (error) {
    core.setFailed(`Failed to create the new release: ${error}`)
  }
}

run()
