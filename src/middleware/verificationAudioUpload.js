import multer from "multer";
import path from "path";

import {
ensureVerificationUploadDir,
VERIFICATION_AUDIO_DIR
} from "../services/verificationUpload.service.js";

ensureVerificationUploadDir();

const storage =
multer.diskStorage({
destination:(
_req,
_file,
cb
)=>{
ensureVerificationUploadDir();
cb(
null,
VERIFICATION_AUDIO_DIR
);
},
filename:(
req,
file,
cb
)=>{
const userId =
req.body?.userId ||
"unknown";

const ext =
path.extname(file.originalname) ||
".m4a";

cb(
null,
`verification-${userId}-${Date.now()}${ext}`
);
}
});

const allowedMimeTypes =
[
"audio/m4a",
"audio/mp4",
"audio/aac",
"audio/mpeg",
"audio/wav",
"audio/x-m4a",
"audio/webm",
"application/octet-stream"
];

export const verificationAudioUpload =
multer({
storage,
limits:{
fileSize:10 * 1024 * 1024
},
fileFilter:(
_req,
file,
cb
)=>{
if(
allowedMimeTypes.includes(file.mimetype) ||
file.originalname?.match(/\.(m4a|mp4|aac|mp3|wav|webm)$/i)
){
cb(null, true);
return;
}

cb(
new Error("Only audio files are allowed")
);
}
});
