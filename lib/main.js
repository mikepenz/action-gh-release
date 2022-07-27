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
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const util_1 = require("./util");
const github_1 = require("./github");
const github_2 = require("@actions/github");
const request_error_1 = require("@octokit/request-error");
const process_1 = require("process");
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const config = (0, util_1.parseConfig)(process_1.env);
            if (!config.input_tag_name && !(0, util_1.isTag)(config.github_ref) && !config.input_draft) {
                throw new Error(`⚠️ GitHub Releases requires a tag`);
            }
            if (config.input_files) {
                const patterns = (0, util_1.unmatchedPatterns)(config.input_files);
                for (const pattern of patterns) {
                    core.warning(`🤔 Pattern '${pattern}' does not match any files.`);
                }
                if (patterns.length > 0 && config.input_fail_on_unmatched_files) {
                    throw new Error(`⚠️ There were unmatched files`);
                }
            }
            const gh = (0, github_2.getOctokit)(config.github_token, {
                throttle: {
                    onRateLimit: (retryAfter, options) => {
                        core.warning(`Request quota exhausted for request ${options.method} ${options.url}`);
                        if (options.request.retryCount === 0) {
                            // only retries once
                            core.info(`Retrying after ${retryAfter} seconds!`);
                            return true;
                        }
                    },
                    onAbuseLimit: (retryAfter, options) => {
                        // does not retry, only logs a warning
                        core.warning(`Abuse detected for request ${options.method} ${options.url}`);
                    }
                }
            });
            //)
            const rel = yield (0, github_1.release)(config, new github_1.GitHubReleaser(gh));
            if (config.input_files) {
                const files = (0, util_1.paths)(config.input_files);
                if (files.length === 0) {
                    core.warning(`🤔 ${config.input_files} not include valid file.`);
                }
                const currentAssets = rel.assets;
                const assets = yield Promise.all(files.map((path) => __awaiter(this, void 0, void 0, function* () {
                    const json = yield (0, github_1.upload)(config, gh, (0, util_1.uploadUrl)(rel.upload_url), path, currentAssets);
                    delete json.uploader;
                    return json;
                }))).catch(error => {
                    throw error;
                });
                core.setOutput('assets', assets);
            }
            core.info(`🎉 Release ready at ${rel.html_url}`);
            core.setOutput('url', rel.html_url);
            core.setOutput('id', rel.id.toString());
            core.setOutput('upload_url', rel.upload_url);
        }
        catch (error) {
            if (error instanceof request_error_1.RequestError) {
                core.setFailed(error.message);
            }
            else {
                core.setFailed(`Failed to create the new release ${error}`);
            }
        }
    });
}
run();
