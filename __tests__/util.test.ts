import {
  alignAssetName,
  errorMessage,
  expandHomePattern,
  isTag,
  normalizeFilePattern,
  normalizeGlobPattern,
  parseConfig,
  parseInputFiles,
  paths,
  releaseBody,
  unmatchedPatterns,
  uploadUrl
} from '../src/util'

import * as pathLib from 'path'

import {assert, describe, expect, it} from 'vitest'

describe('util', () => {
  describe('errorMessage', () => {
    it('reads messages off errors and error-like objects', () => {
      assert.equal(errorMessage(new Error('boom')), 'boom')
      assert.equal(errorMessage({message: 'api boom'}), 'api boom')
    })
    it('falls back for non-error values', () => {
      assert.equal(errorMessage(undefined), 'Unknown error')
      assert.equal(errorMessage(null), 'Unknown error')
      assert.equal(errorMessage('plain'), 'plain')
      assert.equal(errorMessage(404), '404')
    })
  })

  describe('uploadUrl', () => {
    it('strips template', () => {
      assert.equal(
        uploadUrl('https://uploads.github.com/repos/octocat/Hello-World/releases/1/assets{?name,label}'),
        'https://uploads.github.com/repos/octocat/Hello-World/releases/1/assets'
      )
    })
  })
  describe('parseInputFiles', () => {
    it('parses empty strings', () => {
      assert.deepStrictEqual(parseInputFiles(''), [])
    })
    it('parses comma-delimited strings', () => {
      assert.deepStrictEqual(parseInputFiles('foo,bar'), ['foo', 'bar'])
    })
    it('parses newline and comma-delimited (and then some)', () => {
      assert.deepStrictEqual(parseInputFiles('foo,bar\nbaz,boom,\n\ndoom,loom '), [
        'foo',
        'bar',
        'baz',
        'boom',
        'doom',
        'loom'
      ])
    })
    it('handles globs with brace groups containing commas', () => {
      assert.deepStrictEqual(parseInputFiles('./**/*.{exe,deb,tar.gz}\nfoo,bar'), [
        './**/*.{exe,deb,tar.gz}',
        'foo',
        'bar'
      ])
    })
    it('handles single-line brace pattern correctly', () => {
      assert.deepStrictEqual(parseInputFiles('./**/*.{exe,deb,tar.gz}'), ['./**/*.{exe,deb,tar.gz}'])
    })
  })
  describe('releaseBody', () => {
    it('uses input body', () => {
      assert.equal(
        'foo',
        releaseBody({
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_body: 'foo',
          input_body_path: undefined,
          input_draft: false,
          input_prerelease: false,
          input_preserve_order: undefined,
          input_files: [],
          input_overwrite_files: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        })
      )
    })
    it('uses input body path', () => {
      assert.equal(
        'bar',
        releaseBody({
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_body: undefined,
          input_body_path: '__tests__/release.txt',
          input_draft: false,
          input_prerelease: false,
          input_preserve_order: undefined,
          input_files: [],
          input_overwrite_files: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        })
      )
    })
    it('defaults to body path when both body and body path are provided', () => {
      assert.equal(
        'bar',
        releaseBody({
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_body: 'foo',
          input_body_path: '__tests__/release.txt',
          input_draft: false,
          input_prerelease: false,
          input_preserve_order: undefined,
          input_files: [],
          input_overwrite_files: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        })
      )
    })
    it('falls back to body when body_path is missing', () => {
      assert.equal(
        releaseBody({
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_body: 'fallback-body',
          input_body_path: '__tests__/does-not-exist.txt',
          input_draft: false,
          input_prerelease: false,
          input_files: [],
          input_overwrite_files: undefined,
          input_preserve_order: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }),
        'fallback-body'
      )
    })
    it('returns undefined when body_path is missing and body is not provided', () => {
      assert.equal(
        releaseBody({
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_body: undefined,
          input_body_path: '__tests__/does-not-exist.txt',
          input_draft: false,
          input_prerelease: false,
          input_files: [],
          input_overwrite_files: undefined,
          input_preserve_order: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }),
        undefined
      )
    })
  })
  describe('parseConfig', () => {
    it('parses basic config', () => {
      assert.deepStrictEqual(
        parseConfig({
          // note: inputs declared in actions.yml, even when declared not required,
          // are still provided by the actions runtime env as empty strings instead of
          // the normal absent env value one would expect. this breaks things
          // as an empty string !== undefined in terms of what we pass to the api
          // so we cover that in a test case here to ensure undefined values are actually
          // resolved as undefined and not empty strings
          INPUT_TARGET_COMMITISH: '',
          INPUT_DISCUSSION_CATEGORY_NAME: ''
        }),
        {
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_working_directory: undefined,
          input_append_body: false,
          input_body: undefined,
          input_body_path: undefined,
          input_draft: undefined,
          input_prerelease: undefined,
          input_preserve_order: undefined,
          input_files: [],
          input_overwrite_files: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_fail_on_unmatched_files: false,
          input_fail_on_asset_upload_issue: false,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }
      )
    })

    it('parses basic config with commitish', () => {
      assert.deepStrictEqual(
        parseConfig({
          INPUT_TARGET_COMMITISH: 'affa18ef97bc9db20076945705aba8c516139abd'
        }),
        {
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_working_directory: undefined,
          input_append_body: false,
          input_body: undefined,
          input_body_path: undefined,
          input_draft: undefined,
          input_prerelease: undefined,
          input_files: [],
          input_overwrite_files: undefined,
          input_preserve_order: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_fail_on_unmatched_files: false,
          input_fail_on_asset_upload_issue: false,
          input_target_commitish: 'affa18ef97bc9db20076945705aba8c516139abd',
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }
      )
    })
    it('supports discussion category names', () => {
      assert.deepStrictEqual(
        parseConfig({
          INPUT_DISCUSSION_CATEGORY_NAME: 'releases'
        }),
        {
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_working_directory: undefined,
          input_append_body: false,
          input_body: undefined,
          input_body_path: undefined,
          input_draft: undefined,
          input_prerelease: undefined,
          input_files: [],
          input_preserve_order: undefined,
          input_name: undefined,
          input_overwrite_files: undefined,
          input_tag_name: undefined,
          input_fail_on_unmatched_files: false,
          input_fail_on_asset_upload_issue: false,
          input_target_commitish: undefined,
          input_discussion_category_name: 'releases',
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }
      )
    })

    it('supports generating release notes', () => {
      assert.deepStrictEqual(
        parseConfig({
          INPUT_GENERATE_RELEASE_NOTES: 'true'
        }),
        {
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_working_directory: undefined,
          input_append_body: false,
          input_body: undefined,
          input_body_path: undefined,
          input_draft: undefined,
          input_prerelease: undefined,
          input_preserve_order: undefined,
          input_files: [],
          input_overwrite_files: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_fail_on_unmatched_files: false,
          input_fail_on_asset_upload_issue: false,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: true,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }
      )
    })

    it('prefers token input over GITHUB_TOKEN env var', () => {
      assert.deepStrictEqual(
        parseConfig({
          INPUT_DRAFT: 'false',
          INPUT_PRERELEASE: 'true',
          INPUT_PRESERVE_ORDER: 'true',
          GITHUB_TOKEN: 'env-token',
          INPUT_TOKEN: 'input-token'
        }),
        {
          github_ref: '',
          github_repository: '',
          github_token: 'input-token',
          input_working_directory: undefined,
          input_append_body: false,
          input_body: undefined,
          input_body_path: undefined,
          input_draft: false,
          input_prerelease: true,
          input_preserve_order: true,
          input_files: [],
          input_overwrite_files: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_fail_on_unmatched_files: false,
          input_fail_on_asset_upload_issue: false,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }
      )
    })
    it('uses input token as the source of GITHUB_TOKEN by default', () => {
      assert.deepStrictEqual(
        parseConfig({
          INPUT_DRAFT: 'false',
          INPUT_PRERELEASE: 'true',
          INPUT_TOKEN: 'input-token'
        }),
        {
          github_ref: '',
          github_repository: '',
          github_token: 'input-token',
          input_working_directory: undefined,
          input_append_body: false,
          input_body: undefined,
          input_body_path: undefined,
          input_draft: false,
          input_prerelease: true,
          input_preserve_order: undefined,
          input_files: [],
          input_overwrite_files: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_fail_on_unmatched_files: false,
          input_fail_on_asset_upload_issue: false,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }
      )
    })
    it('parses basic config with draft and prerelease', () => {
      assert.deepStrictEqual(
        parseConfig({
          INPUT_DRAFT: 'false',
          INPUT_PRERELEASE: 'true'
        }),
        {
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_working_directory: undefined,
          input_append_body: false,
          input_body: undefined,
          input_body_path: undefined,
          input_draft: false,
          input_prerelease: true,
          input_preserve_order: undefined,
          input_files: [],
          input_overwrite_files: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_fail_on_unmatched_files: false,
          input_fail_on_asset_upload_issue: false,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }
      )
    })
    it('parses basic config where make_latest is passed', () => {
      assert.deepStrictEqual(
        parseConfig({
          INPUT_MAKE_LATEST: 'false'
        }),
        {
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_working_directory: undefined,
          input_append_body: false,
          input_body: undefined,
          input_body_path: undefined,
          input_draft: undefined,
          input_prerelease: undefined,
          input_preserve_order: undefined,
          input_files: [],
          input_name: undefined,
          input_overwrite_files: undefined,
          input_tag_name: undefined,
          input_fail_on_unmatched_files: false,
          input_fail_on_asset_upload_issue: false,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: 'false',
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }
      )
    })
    it('parses basic config with append_body', () => {
      assert.deepStrictEqual(
        parseConfig({
          INPUT_APPEND_BODY: 'true'
        }),
        {
          github_ref: '',
          github_repository: '',
          github_token: '',
          input_working_directory: undefined,
          input_append_body: true,
          input_body: undefined,
          input_body_path: undefined,
          input_draft: undefined,
          input_prerelease: undefined,
          input_preserve_order: undefined,
          input_files: [],
          input_overwrite_files: undefined,
          input_name: undefined,
          input_tag_name: undefined,
          input_fail_on_unmatched_files: false,
          input_fail_on_asset_upload_issue: false,
          input_target_commitish: undefined,
          input_discussion_category_name: undefined,
          input_generate_release_notes: false,
          input_make_latest: undefined,
          input_previous_tag: undefined,
          input_concurrency: 4,
          input_on_tag_conflict: 'update',
          input_draft_during_upload: true
        }
      )
    })
  })
  describe('isTag', () => {
    it('returns true for tags', async () => {
      assert.equal(isTag('refs/tags/foo'), true)
    })
    it('returns false for other kinds of refs', async () => {
      assert.equal(isTag('refs/heads/master'), false)
    })
  })

  describe('paths', () => {
    it('resolves files given a set of paths', async () => {
      assert.deepStrictEqual(paths(['tests/data/foo/**/*', 'tests/data/does/not/exist/*']), ['tests/data/foo/bar.txt'])
    })

    it('resolves files relative to working_directory', async () => {
      assert.deepStrictEqual(paths(['data/foo/**/*'], 'tests'), ['tests/data/foo/bar.txt'])
    })

    // dot: true — wildcards match hidden files. node:fs globSync cannot express this,
    // which is why this action still depends on `glob`.
    it('matches hidden files with a wildcard', async () => {
      assert.deepStrictEqual(paths(['tests/data/dotdir/.*']), ['tests/data/dotdir/.hidden.txt'])
      assert.ok(paths(['tests/data/dotdir/*']).includes('tests/data/dotdir/.hidden.txt'))
    })

    // Escaping glob metacharacters is documented in action.yml and is likewise
    // unsupported by node:fs globSync.
    it('matches a literal filename containing glob metacharacters when escaped', async () => {
      assert.deepStrictEqual(paths(['tests/data/dotdir/bracket\\[1\\].txt']), ['tests/data/dotdir/bracket[1].txt'])
    })

    it('expands brace groups into every matching file', async () => {
      assert.deepStrictEqual(paths(['tests/data/{foo,dotdir}/*']).sort(), [
        'tests/data/dotdir/.hidden.txt',
        'tests/data/dotdir/bracket[1].txt',
        'tests/data/foo/bar.txt'
      ])
    })

    it('drops directories that match the pattern', async () => {
      assert.deepStrictEqual(paths(['tests/data/*']), [])
    })

    // glob returns matches relative to the search root, so an absolute pattern comes
    // back relative — still resolvable, because the search root is the process cwd.
    it('resolves absolute patterns', async () => {
      assert.deepStrictEqual(paths([pathLib.resolve('tests/data/foo/bar.txt')]), ['tests/data/foo/bar.txt'])
    })

    it('resolves absolute patterns against a working_directory', async () => {
      assert.deepStrictEqual(paths([pathLib.resolve('tests/data/foo/bar.txt')], 'tests'), ['tests/data/foo/bar.txt'])
    })

    it('ignores patterns that match nothing', async () => {
      assert.deepStrictEqual(paths(['tests/data/does/not/exist/*']), [])
    })
  })

  describe('unmatchedPatterns', () => {
    it("returns the patterns that don't match any files", async () => {
      assert.deepStrictEqual(unmatchedPatterns(['tests/data/**/*', 'tests/data/does/not/exist/*']), [
        'tests/data/does/not/exist/*'
      ])
    })

    it('resolves unmatched relative to working_directory', async () => {
      assert.deepStrictEqual(unmatchedPatterns(['data/does/not/exist/*'], 'tests'), ['data/does/not/exist/*'])
    })

    it('treats a pattern matching only directories as unmatched', async () => {
      assert.deepStrictEqual(unmatchedPatterns(['tests/data/*']), ['tests/data/*'])
    })

    it('accepts a pattern matching a hidden file', async () => {
      assert.deepStrictEqual(unmatchedPatterns(['tests/data/dotdir/.*']), [])
    })
  })

  describe('normalizeFilePattern', () => {
    it('rewrites backslashes to forward slashes on windows only', () => {
      assert.equal(normalizeGlobPattern('dist\\bin\\*.zip', 'win32'), 'dist/bin/*.zip')
      assert.equal(normalizeGlobPattern('dist\\bin\\*.zip', 'linux'), 'dist\\bin\\*.zip')
    })

    it('expands a leading ~ to the home directory', () => {
      assert.equal(expandHomePattern('~', '/home/me'), '/home/me')
      assert.equal(expandHomePattern('~/out/*.zip', '/home/me'), pathLib.join('/home/me', 'out/*.zip'))
      assert.equal(expandHomePattern('~backup/*.zip', '/home/me'), '~backup/*.zip')
      assert.equal(expandHomePattern('out/~/*.zip', '/home/me'), 'out/~/*.zip')
    })

    it('expands the home directory before normalizing separators', () => {
      assert.equal(normalizeFilePattern('~\\out\\*.zip', 'win32', 'C:\\Users\\me'), 'C:/Users/me/out/*.zip')
    })
  })

  describe('replaceSpacesWithDots', () => {
    it('replaces all spaces with dots', () => {
      expect(alignAssetName('John Doe.bla')).toBe('John.Doe.bla')
    })

    it('handles names with multiple spaces', () => {
      expect(alignAssetName('John William Doe.bla')).toBe('John.William.Doe.bla')
    })

    it('returns the same string if there are no spaces', () => {
      expect(alignAssetName('JohnDoe')).toBe('JohnDoe')
    })
  })
})

describe('parseInputFiles edge cases', () => {
  it('handles multiple brace groups on same line', () => {
    assert.deepStrictEqual(parseInputFiles('./**/*.{exe,deb},./dist/**/*.{zip,tar.gz}'), [
      './**/*.{exe,deb}',
      './dist/**/*.{zip,tar.gz}'
    ])
  })

  it('handles nested braces', () => {
    assert.deepStrictEqual(parseInputFiles('path/{a,{b,c}}/file.txt'), ['path/{a,{b,c}}/file.txt'])
  })

  it('handles empty comma-separated values', () => {
    assert.deepStrictEqual(parseInputFiles('foo,,bar'), ['foo', 'bar'])
  })

  it('handles commas with spaces around braces', () => {
    assert.deepStrictEqual(parseInputFiles(' ./**/*.{exe,deb} , file.txt '), ['./**/*.{exe,deb}', 'file.txt'])
  })

  it('handles mixed newlines and commas with braces', () => {
    assert.deepStrictEqual(parseInputFiles('file1.txt\n./**/*.{exe,deb},file2.txt\nfile3.txt'), [
      'file1.txt',
      './**/*.{exe,deb}',
      'file2.txt',
      'file3.txt'
    ])
  })
})
