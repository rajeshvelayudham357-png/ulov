import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename =
fileURLToPath(import.meta.url);

const __dirname =
path.dirname(__filename);

export const VERIFICATION_AUDIO_DIR =
path.join(
__dirname,
"../../uploads/verification-audio"
);

export const VERIFICATION_VIDEO_DIR =
path.join(
__dirname,
"../../uploads/verification-video"
);

export const ensureVerificationUploadDirs =
()=>{
[
VERIFICATION_AUDIO_DIR,
VERIFICATION_VIDEO_DIR
].forEach((dir)=>{
if(!fs.existsSync(dir)){
fs.mkdirSync(
dir,
{ recursive: true }
);
}
});
};

export const ensureVerificationUploadDir =
ensureVerificationUploadDirs;

export const buildVerificationAudioUrl =
(filename)=>
`/uploads/verification-audio/${filename}`;

export const buildVerificationVideoUrl =
(filename)=>
`/uploads/verification-video/${filename}`;
