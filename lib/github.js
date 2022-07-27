"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.release = exports.upload = exports.mimeOrDefault = exports.asset = exports.GitHubReleaser = void 0;
const core = __importStar(require("@actions/core"));
const util_1 = require("./util");
const fs_1 = require("fs");
const mime_1 = require("mime");
const path_1 = require("path");
const request_error_1 = require("@octokit/request-error");
class GitHubReleaser {
    constructor(github) {
        this.github = github;
    }
    getReleaseByTag(params) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.github.rest.repos.getReleaseByTag(params);
        });
    }
    createRelease(params) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.github.rest.repos.createRelease(params);
        });
    }
    updateRelease(params) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.github.rest.repos.updateRelease(params);
        });
    }
    allReleases(params) {
        const updatedParams = Object.assign({ per_page: 100 }, params);
        return this.github.paginate.iterator(this.github.rest.repos.listReleases.endpoint.merge(updatedParams));
    }
}
exports.GitHubReleaser = GitHubReleaser;
const asset = (path) => {
    return {
        name: (0, path_1.basename)(path),
        mime: (0, exports.mimeOrDefault)(path),
        size: (0, fs_1.statSync)(path).size,
        data: (0, fs_1.readFileSync)(path)
    };
};
exports.asset = asset;
const mimeOrDefault = (path) => {
    return (0, mime_1.getType)(path) || 'application/octet-stream';
};
exports.mimeOrDefault = mimeOrDefault;
/* eslint-disable @typescript-eslint/no-explicit-any */
const upload = (config, github, url, path, currentAssets) => __awaiter(void 0, void 0, void 0, function* () {
    const [owner, repo] = config.github_repository.split('/');
    const { name, size, mime, data: body } = (0, exports.asset)(path);
    const currentAsset = currentAssets.find(({ name: currentName }) => currentName === name);
    if (currentAsset) {
        core.info(`♻️ Deleting previously uploaded asset ${name}...`);
        yield github.rest.repos.deleteReleaseAsset({
            asset_id: currentAsset.id || 1,
            owner,
            repo
        });
    }
    core.info(`⬆️ Uploading ${name}...`);
    const endpoint = new URL(url);
    endpoint.searchParams.append('name', name);
    const resp = yield fetch(endpoint, {
        headers: {
            'content-length': `${size}`,
            'content-type': mime,
            authorization: `token ${config.github_token}`
        },
        method: 'POST',
        body
    });
    const json = yield resp.json();
    if (resp.status !== 201) {
        throw new Error(`Failed to upload release asset ${name}. received status code ${resp.status}\n${json.message}\n${JSON.stringify(json.errors)}`);
    }
    return json;
});
exports.upload = upload;
const release = (config, releaser, maxRetries = 3) => __awaiter(void 0, void 0, void 0, function* () {
    var e_1, _a;
    var _b;
    if (maxRetries <= 0) {
        core.error(`❌ Too many retries. Aborting...`);
        throw new Error('Too many retries.');
    }
    const [owner, repo] = config.github_repository.split('/');
    const tag = config.input_tag_name || ((0, util_1.isTag)(config.github_ref) ? config.github_ref.replace('refs/tags/', '') : '');
    const discussion_category_name = config.input_discussion_category_name;
    const generate_release_notes = config.input_generate_release_notes;
    try {
        let existingRelease = {};
        if (config.input_draft) {
            try {
                // you can't get a an existing draft by tag
                // so we must find one in the list of all releases
                for (var _c = __asyncValues(releaser.allReleases({
                    owner,
                    repo
                })), _d; _d = yield _c.next(), !_d.done;) {
                    const response = _d.value;
                    const rel = response.data.find(r => r.tag_name === tag);
                    if (rel) {
                        existingRelease = rel;
                        break;
                    }
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (_d && !_d.done && (_a = _c.return)) yield _a.call(_c);
                }
                finally { if (e_1) throw e_1.error; }
            }
        }
        else {
            existingRelease = (yield releaser.getReleaseByTag({
                owner,
                repo,
                tag
            })).data;
        }
        const release_id = existingRelease.id;
        let target_commitish;
        if (config.input_target_commitish && config.input_target_commitish !== existingRelease.target_commitish) {
            core.info(`Updating commit from "${existingRelease.target_commitish}" to "${config.input_target_commitish}"`);
            target_commitish = config.input_target_commitish;
        }
        else {
            target_commitish = existingRelease.target_commitish;
        }
        const tag_name = tag;
        const name = config.input_name || existingRelease.name || tag;
        // revisit: support a new body-concat-strategy input for accumulating
        // body parts as a release gets updated. some users will likely want this while
        // others won't previously this was duplicating content for most which
        // no one wants
        const workflowBody = (0, util_1.releaseBody)(config) || '';
        const existingReleaseBody = existingRelease.body || '';
        let body;
        if (config.input_append_body && workflowBody && existingReleaseBody) {
            body = `${existingReleaseBody}\n${workflowBody}`;
        }
        else {
            body = workflowBody || existingReleaseBody;
        }
        const draft = config.input_draft !== undefined ? config.input_draft : existingRelease.draft;
        const prerelease = config.input_prerelease !== undefined ? config.input_prerelease : existingRelease.prerelease;
        const rel = yield releaser.updateRelease({
            owner,
            repo,
            release_id,
            tag_name,
            target_commitish,
            name,
            body,
            draft,
            prerelease,
            discussion_category_name,
            generate_release_notes
        });
        return rel.data;
    }
    catch (error) {
        if (error instanceof request_error_1.RequestError && error.status === 404) {
            const tag_name = tag;
            const name = config.input_name || tag;
            const body = (0, util_1.releaseBody)(config);
            const draft = config.input_draft;
            const prerelease = config.input_prerelease;
            const target_commitish = config.input_target_commitish;
            let commitMessage = '';
            if (target_commitish) {
                commitMessage = ` using commit "${target_commitish}"`;
            }
            core.info(`👩‍🏭 Creating new GitHub release for tag ${tag_name}${commitMessage}...`);
            try {
                const newRelease = yield releaser.createRelease({
                    owner,
                    repo,
                    tag_name,
                    name,
                    body,
                    draft,
                    prerelease,
                    target_commitish,
                    discussion_category_name,
                    generate_release_notes
                });
                return newRelease.data;
            }
            catch (newError) {
                if (newError instanceof request_error_1.RequestError) {
                    // presume a race with competing metrix runs
                    core.warning(`⚠️ GitHub release failed with status: ${newError.status}\n${JSON.stringify(((_b = newError.response) === null || _b === void 0 ? void 0 : _b.data) || '')}\nretrying... (${maxRetries - 1} retries remaining)`);
                }
                else {
                    core.setFailed(`Failed to create the new release ${newError}`);
                }
                return (0, exports.release)(config, releaser, maxRetries - 1);
            }
        }
        else {
            core.warning(`⚠️ Unexpected error fetching GitHub release for tag ${config.github_ref}: ${error}`);
            throw error;
        }
    }
});
exports.release = release;
