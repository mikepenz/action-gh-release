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
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTag = exports.unmatchedPatterns = exports.paths = exports.parseConfig = exports.parseInputFiles = exports.releaseBody = exports.uploadUrl = void 0;
const glob = __importStar(require("glob"));
const fs_1 = require("fs");
const uploadUrl = (url) => {
    const templateMarkerPos = url.indexOf('{');
    if (templateMarkerPos > -1) {
        return url.substring(0, templateMarkerPos);
    }
    return url;
};
exports.uploadUrl = uploadUrl;
const releaseBody = (config) => {
    return (config.input_body_path && (0, fs_1.readFileSync)(config.input_body_path).toString('utf8')) || config.input_body;
};
exports.releaseBody = releaseBody;
const parseInputFiles = (files) => {
    return files.split(/\r?\n/).reduce((acc, line) => acc
        .concat(line.split(','))
        .filter(pat => pat)
        .map(pat => pat.trim()), []);
};
exports.parseInputFiles = parseInputFiles;
const parseConfig = (env) => {
    var _a;
    return {
        github_token: env.GITHUB_TOKEN || env.INPUT_TOKEN || '',
        github_ref: env.GITHUB_REF || '',
        github_repository: env.INPUT_REPOSITORY || env.GITHUB_REPOSITORY || '',
        input_name: env.INPUT_NAME,
        input_tag_name: (_a = env.INPUT_TAG_NAME) === null || _a === void 0 ? void 0 : _a.trim(),
        input_body: env.INPUT_BODY,
        input_body_path: env.INPUT_BODY_PATH,
        input_files: (0, exports.parseInputFiles)(env.INPUT_FILES || ''),
        input_draft: env.INPUT_DRAFT ? env.INPUT_DRAFT === 'true' : undefined,
        input_prerelease: env.INPUT_PRERELEASE ? env.INPUT_PRERELEASE === 'true' : undefined,
        input_fail_on_unmatched_files: env.INPUT_FAIL_ON_UNMATCHED_FILES === 'true',
        input_target_commitish: env.INPUT_TARGET_COMMITISH || undefined,
        input_discussion_category_name: env.INPUT_DISCUSSION_CATEGORY_NAME || undefined,
        input_generate_release_notes: env.INPUT_GENERATE_RELEASE_NOTES === 'true',
        input_append_body: env.INPUT_APPEND_BODY === 'true'
    };
};
exports.parseConfig = parseConfig;
const paths = (patterns) => {
    return patterns.reduce((acc, pattern) => {
        return acc.concat(glob.sync(pattern).filter(path => (0, fs_1.statSync)(path).isFile()));
    }, []);
};
exports.paths = paths;
const unmatchedPatterns = (patterns) => {
    return patterns.reduce((acc, pattern) => {
        return acc.concat(glob.sync(pattern).filter(path => (0, fs_1.statSync)(path).isFile()).length === 0 ? [pattern] : []);
    }, []);
};
exports.unmatchedPatterns = unmatchedPatterns;
const isTag = (ref) => {
    return ref.startsWith('refs/tags/');
};
exports.isTag = isTag;
