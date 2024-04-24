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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonResolver = void 0;
const axios_1 = __importDefault(require("axios"));
const url_1 = require("url");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function jsonResolver() {
    return __awaiter(this, arguments, void 0, function* (jsonToResolve = '', relativeDir = __dirname) {
        try {
            const resolvedJson = JSON.parse(jsonToResolve);
            if (resolvedJson && (Array.isArray(resolvedJson) || typeof resolvedJson === 'object')) {
                return jsonToResolve;
            }
        }
        catch (_a) { }
        if (jsonToResolve.match(/^(http|https):\/\//)) {
            const result = yield axios_1.default.get(jsonToResolve, { transformResponse: data => data });
            return result.data;
        }
        let resolvedFilename = jsonToResolve;
        if (jsonToResolve.match(/file:\/\//)) {
            resolvedFilename = new url_1.URL(jsonToResolve);
        }
        else if (jsonToResolve.split(path.sep)[0].match(/^\.{1,2}$/)) {
            resolvedFilename = path.resolve(relativeDir, jsonToResolve);
        }
        if (typeof resolvedFilename === 'string' && resolvedFilename.startsWith('.')) {
            resolvedFilename = resolvedFilename.replace(/^\./, relativeDir);
        }
        if (!fs.existsSync(resolvedFilename)) {
            throw new Error(`Cannot find JSON file "${jsonToResolve}" using relative dir "${relativeDir}" (resolved path "${resolvedFilename}")`);
        }
        return fs.readFileSync(resolvedFilename, 'utf-8');
    });
}
exports.jsonResolver = jsonResolver;
