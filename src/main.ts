import * as core from '@actions/core'
import {paths, parseConfig, isTag, unmatchedPatterns, uploadUrl} from './util.js'
import {release, upload, finalizeRelease, GitHubReleaser} from './github.js'
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
    if (config.input_files && config.input_files?.length > 0) {
      const files = paths(config.input_files, config.input_working_directory)
      if (files.length === 0) {
        if (config.input_fail_on_unmatched_files) {
          throw new Error(`⚠️ ${config.input_files} not include valid file.`)
        } else {
          core.warning(`🤔 ${config.input_files} not include valid file.`)
        }
      }
      const currentAssets = rel.assets

      const uploadFile = async (path: string) => {
        const json = await upload(config, gh, uploadUrl(rel.upload_url), path, currentAssets)
        if (json) {
          delete json.uploader
        }
        return json
      }

      let results: (any | null)[]
      if (!config.input_preserve_order) {
        results = await Promise.all(files.map(uploadFile))
      } else {
        results = []
        for (const path of files) {
          results.push(await uploadFile(path))
        }
      }

      const assets = results.filter(Boolean)
      core.setOutput('assets', assets)
    }

    console.log('Finalizing release...')
    rel = await finalizeRelease(config, releaser, rel)

    core.info(`🎉 Release ready at ${rel.html_url}`)
    core.setOutput('url', rel.html_url)
    core.setOutput('id', rel.id.toString())
    core.setOutput('upload_url', rel.upload_url)
  } catch (error) {
    core.setFailed(`Failed to create the new release: ${error}`)
  }
}

run()
