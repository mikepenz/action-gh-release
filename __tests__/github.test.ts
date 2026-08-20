import {
  asset,
  finalizeRelease,
  findTagFromReleases,
  mimeOrDefault,
  release,
  Release,
  Releaser,
  upload
} from '../src/github'
import {Config} from '../src/util'

import {assert, describe, expect, it} from 'vitest'

describe('github', () => {
  describe('mimeOrDefault', () => {
    it('returns a specific mime for common path', async () => {
      assert.equal(mimeOrDefault('foo.tar.gz'), 'application/gzip')
    })
    it('returns default mime for uncommon path', async () => {
      assert.equal(mimeOrDefault('foo.uncommon'), 'application/octet-stream')
    })
  })

  describe('asset', () => {
    it('derives asset info from a path', async () => {
      const {name, mime, size} = asset('tests/data/foo/bar.txt')
      assert.equal(name, 'bar.txt')
      assert.equal(mime, 'text/plain')
      assert.equal(size, 10)
    })
  })

  describe('findTagFromReleases', () => {
    const owner = 'owner'
    const repo = 'repo'

    const mockRelease: Release = {
      id: 1,
      upload_url: `https://api.github.com/repos/${owner}/${repo}/releases/1/assets`,
      html_url: `https://github.com/${owner}/${repo}/releases/tag/v1.0.0`,
      tag_name: 'v1.0.0',
      name: 'Test Release',
      body: 'Test body',
      target_commitish: 'main',
      draft: false,
      prerelease: false,
      assets: []
    } as const

    const mockReleaser: Releaser = {
      getReleaseByTag: () => Promise.reject('Not implemented'),
      createRelease: () => Promise.reject('Not implemented'),
      updateRelease: () => Promise.reject('Not implemented'),
      finalizeRelease: () => Promise.reject('Not implemented'),
      deleteRelease: () => Promise.reject('Not implemented'),
      allReleases: async function* () {
        yield {data: [mockRelease]}
      }
    } as const

    describe('when the tag_name is not an empty string', () => {
      const targetTag = 'v1.0.0'

      it('finds a matching release in first batch of results', async () => {
        const targetRelease = {
          ...mockRelease,
          owner,
          repo,
          tag_name: targetTag
        }
        const otherRelease = {
          ...mockRelease,
          owner,
          repo,
          tag_name: 'v1.0.1'
        }

        const releaser = {
          ...mockReleaser,
          allReleases: async function* () {
            yield {data: [targetRelease]}
            yield {data: [otherRelease]}
          }
        }

        const result = await findTagFromReleases(releaser, owner, repo, targetTag)

        assert.deepStrictEqual(result, targetRelease)
      })

      it('stops scanning after the bounded number of pages', async () => {
        let pages = 0
        const releaser = {
          ...mockReleaser,
          allReleases: async function* () {
            for (;;) {
              pages++
              yield {data: [{...mockRelease, tag_name: 'v1.0.1'}]}
            }
          }
        }

        const result = await findTagFromReleases(releaser, owner, repo, targetTag)

        assert.strictEqual(result, undefined)
        assert.strictEqual(pages, 2)
      })

      it('finds a matching release in second batch of results', async () => {
        const targetRelease = {
          ...mockRelease,
          owner,
          repo,
          tag_name: targetTag
        }
        const otherRelease = {
          ...mockRelease,
          owner,
          repo,
          tag_name: 'v1.0.1'
        }

        const releaser = {
          ...mockReleaser,
          allReleases: async function* () {
            yield {data: [otherRelease]}
            yield {data: [targetRelease]}
          }
        }

        const result = await findTagFromReleases(releaser, owner, repo, targetTag)
        assert.deepStrictEqual(result, targetRelease)
      })

      it('returns undefined when a release is not found in any batch', async () => {
        const otherRelease = {
          ...mockRelease,
          owner,
          repo,
          tag_name: 'v1.0.1'
        }
        const releaser = {
          ...mockReleaser,
          allReleases: async function* () {
            yield {data: [otherRelease]}
            yield {data: [otherRelease]}
          }
        }

        const result = await findTagFromReleases(releaser, owner, repo, targetTag)

        assert.strictEqual(result, undefined)
      })

      it('returns undefined when no releases are returned', async () => {
        const releaser = {
          ...mockReleaser,
          allReleases: async function* () {
            yield {data: []}
          }
        }

        const result = await findTagFromReleases(releaser, owner, repo, targetTag)

        assert.strictEqual(result, undefined)
      })
    })

    describe('when the tag_name is an empty string', () => {
      const emptyTag = ''

      it('finds a matching release in first batch of results', async () => {
        const targetRelease = {
          ...mockRelease,
          owner,
          repo,
          tag_name: emptyTag
        }
        const otherRelease = {
          ...mockRelease,
          owner,
          repo,
          tag_name: 'v1.0.1'
        }

        const releaser = {
          ...mockReleaser,
          allReleases: async function* () {
            yield {data: [targetRelease]}
            yield {data: [otherRelease]}
          }
        }

        const result = await findTagFromReleases(releaser, owner, repo, emptyTag)

        assert.deepStrictEqual(result, targetRelease)
      })

      it('finds a matching release in second batch of results', async () => {
        const targetRelease = {
          ...mockRelease,
          owner,
          repo,
          tag_name: emptyTag
        }
        const otherRelease = {
          ...mockRelease,
          owner,
          repo,
          tag_name: 'v1.0.1'
        }

        const releaser = {
          ...mockReleaser,
          allReleases: async function* () {
            yield {data: [otherRelease]}
            yield {data: [targetRelease]}
          }
        }

        const result = await findTagFromReleases(releaser, owner, repo, emptyTag)
        assert.deepStrictEqual(result, targetRelease)
      })

      it('returns undefined when a release is not found in any batch', async () => {
        const otherRelease = {
          ...mockRelease,
          owner,
          repo,
          tag_name: 'v1.0.1'
        }
        const releaser = {
          ...mockReleaser,
          allReleases: async function* () {
            yield {data: [otherRelease]}
            yield {data: [otherRelease]}
          }
        }

        const result = await findTagFromReleases(releaser, owner, repo, emptyTag)

        assert.strictEqual(result, undefined)
      })

      it('returns undefined when no releases are returned', async () => {
        const releaser = {
          ...mockReleaser,
          allReleases: async function* () {
            yield {data: []}
          }
        }

        const result = await findTagFromReleases(releaser, owner, repo, emptyTag)

        assert.strictEqual(result, undefined)
      })
    })
  })

  describe('upload against an immutable release', () => {
    const immutableError = {
      status: 422,
      response: {data: {message: 'Release asset upload is not allowed for an immutable release'}}
    }

    const github = {
      request: () => Promise.reject(immutableError),
      rest: {repos: {deleteReleaseAsset: () => Promise.reject('should not delete')}},
      paginate: () => Promise.reject('should not paginate')
    } as any

    const uploadConfig = (overrides: Partial<Config>): Config =>
      ({
        github_token: 't',
        github_ref: 'refs/tags/v1.0.0',
        github_repository: 'o/r',
        input_files: [],
        input_fail_on_unmatched_files: false,
        input_generate_release_notes: false,
        input_append_body: false,
        input_make_latest: undefined,
        input_concurrency: 4,
        input_on_tag_conflict: 'update',
        input_draft_during_upload: true,
        ...overrides
      }) as Config

    const uploadWith = (config: Config) =>
      upload(config, github, 'https://uploads/repos/o/r/releases/1/assets', 'tests/data/foo/bar.txt', [])

    it('fails with an actionable message when configured to fail', async () => {
      await expect(uploadWith(uploadConfig({input_fail_on_asset_upload_issue: true}))).rejects.toThrow(
        /Cannot upload asset bar\.txt to an immutable release\..*Upload assets to a draft release/s
      )
    })

    it('points prereleases at the draft-then-publish workaround', async () => {
      await expect(
        uploadWith(uploadConfig({input_fail_on_asset_upload_issue: true, input_prerelease: true}))
      ).rejects.toThrow(/set draft: true/)
    })

    it('points at draft_during_upload when it was disabled', async () => {
      await expect(
        uploadWith(uploadConfig({input_fail_on_asset_upload_issue: true, input_draft_during_upload: false}))
      ).rejects.toThrow(/Remove draft_during_upload: false/)
    })

    it('honors fail_on_asset_upload_issue being unset', async () => {
      assert.strictEqual(await uploadWith(uploadConfig({})), null)
    })
  })

  describe('error handling', () => {
    it('handles 422 already_exists error gracefully', async () => {
      const mockReleaser: Releaser = {
        // drafts are invisible to getReleaseByTag, which 404s and falls back to listing
        getReleaseByTag: () => Promise.reject({status: 404}),
        createRelease: () =>
          Promise.reject({
            status: 422,
            response: {data: {errors: [{code: 'already_exists'}]}}
          }),
        updateRelease: () =>
          Promise.resolve({
            data: {
              id: 1,
              upload_url: 'test',
              html_url: 'test',
              tag_name: 'v1.0.0',
              name: 'test',
              body: 'test',
              target_commitish: 'main',
              draft: true,
              prerelease: false,
              assets: []
            }
          }),
        finalizeRelease: async () => {},
        deleteRelease: async () => {},
        allReleases: async function* () {
          yield {
            data: [
              {
                id: 1,
                upload_url: 'test',
                html_url: 'test',
                tag_name: 'v1.0.0',
                name: 'test',
                body: 'test',
                target_commitish: 'main',
                draft: false,
                prerelease: false,
                assets: []
              }
            ]
          }
        }
      } as const

      const config = {
        github_token: 'test-token',
        github_ref: 'refs/tags/v1.0.0',
        github_repository: 'owner/repo',
        input_tag_name: undefined,
        input_name: undefined,
        input_body: undefined,
        input_body_path: undefined,
        input_files: [],
        input_draft: undefined,
        input_prerelease: undefined,
        input_preserve_order: undefined,
        input_overwrite_files: undefined,
        input_fail_on_unmatched_files: false,
        input_target_commitish: undefined,
        input_discussion_category_name: undefined,
        input_generate_release_notes: false,
        input_append_body: false,
        input_make_latest: undefined
      }

      const result = await release(config, mockReleaser, 1)
      assert.ok(result)
      assert.equal(result.id, 1)
    })

    it('propagates non-404 lookup failures instead of scanning releases', async () => {
      const releaser = {
        getReleaseByTag: () => Promise.reject({status: 500}),
        createRelease: () => Promise.reject('should not create'),
        updateRelease: () => Promise.reject('should not update'),
        finalizeRelease: async () => {},
        deleteRelease: async () => {},
        allReleases: async function* () {
          throw new Error('should not list releases')
        }
      } as unknown as Releaser

      const config = {
        github_token: 'test-token',
        github_ref: 'refs/tags/v1.0.0',
        github_repository: 'owner/repo',
        input_files: [],
        input_fail_on_unmatched_files: false,
        input_generate_release_notes: false,
        input_append_body: false,
        input_make_latest: undefined,
        input_concurrency: 4,
        input_on_tag_conflict: 'update' as const,
        input_draft_during_upload: true
      }

      await expect(release(config, releaser, 1)).rejects.toMatchObject({status: 500})
    })
  })
})

describe('finalizeRelease', () => {
  const draft: Release = {
    id: 1,
    upload_url: 'https://uploads/repos/o/r/releases/1/assets{?name,label}',
    html_url: 'https://draft',
    tag_name: 'v1.0.0',
    name: 'v1.0.0',
    body: '',
    target_commitish: 'main',
    draft: true,
    prerelease: false,
    assets: []
  }

  const published: Release = {...draft, id: 2, draft: false, html_url: 'https://published'}

  const tagConflict = {
    status: 422,
    response: {data: {errors: [{resource: 'Release', code: 'already_exists', field: 'tag_name'}]}}
  }

  const baseConfig = {
    github_token: 't',
    github_ref: 'refs/tags/v1.0.0',
    github_repository: 'o/r',
    input_files: [],
    input_fail_on_unmatched_files: false,
    input_generate_release_notes: false,
    input_append_body: false,
    input_make_latest: undefined,
    input_concurrency: 4,
    input_on_tag_conflict: 'update' as const
  }

  const releaserFor = (deleted: number[]): Releaser => ({
    getReleaseByTag: async () => ({data: published}),
    createRelease: () => Promise.reject('Not implemented'),
    updateRelease: async () => ({data: published}),
    finalizeRelease: () => Promise.reject(tagConflict),
    deleteRelease: async ({release_id}) => {
      deleted.push(release_id)
    },
    allReleases: async function* () {
      yield {data: [published]}
    }
  })

  it('adopts the conflicting release and drops the draft when on_tag_conflict is update', async () => {
    const deleted: number[] = []
    const result = await finalizeRelease(baseConfig, releaserFor(deleted), draft)
    assert.equal(result.id, 2)
    assert.deepEqual(deleted, [1])
  })

  it('rethrows when on_tag_conflict is fail', async () => {
    const deleted: number[] = []
    let thrown: any
    try {
      await finalizeRelease({...baseConfig, input_on_tag_conflict: 'fail'}, releaserFor(deleted), draft)
    } catch (error) {
      thrown = error
    }
    assert.equal(thrown?.status, 422)
    assert.deepEqual(deleted, [])
  })
})

describe('draft_during_upload', () => {
  const baseConfig = {
    github_token: 't',
    github_ref: 'refs/tags/v1.0.0',
    github_repository: 'o/r',
    input_files: [],
    input_fail_on_unmatched_files: false,
    input_generate_release_notes: false,
    input_append_body: false,
    input_make_latest: undefined,
    input_concurrency: 4,
    input_on_tag_conflict: 'update' as const,
    input_draft_during_upload: true
  }

  const capturingReleaser = (drafts: (boolean | undefined)[]): Releaser => ({
    getReleaseByTag: () => Promise.reject({status: 404}),
    createRelease: async params => {
      drafts.push(params.draft)
      return {
        data: {
          id: 1,
          upload_url: 'u',
          html_url: 'h',
          tag_name: params.tag_name,
          name: params.name,
          body: params.body,
          target_commitish: 'main',
          draft: !!params.draft,
          prerelease: false,
          assets: []
        }
      }
    },
    updateRelease: () => Promise.reject('Not implemented'),
    finalizeRelease: () => Promise.reject('Not implemented'),
    deleteRelease: () => Promise.reject('Not implemented'),
    allReleases: async function* () {
      yield {data: []}
    }
  })

  it('creates a draft by default', async () => {
    const drafts: (boolean | undefined)[] = []
    await release(baseConfig, capturingReleaser(drafts))
    assert.deepEqual(drafts, [true])
  })

  it('creates the release published when disabled', async () => {
    const drafts: (boolean | undefined)[] = []
    await release({...baseConfig, input_draft_during_upload: false}, capturingReleaser(drafts))
    assert.deepEqual(drafts, [false])
  })

  it('still creates a draft when draft is requested', async () => {
    const drafts: (boolean | undefined)[] = []
    await release({...baseConfig, input_draft_during_upload: false, input_draft: true}, capturingReleaser(drafts))
    assert.deepEqual(drafts, [true])
  })
})
