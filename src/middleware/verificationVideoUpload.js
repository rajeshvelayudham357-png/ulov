import multer from "multer";
import path from "path";

import {
ensureVerificationUploadDirs,
VERIFICATION_VIDEO_DIR
} from "../services/verificationUpload.service.js";

ensureVerificationUploadDirs();

const storage =
multer.diskStorage({
destination:(
_req,
_file,
cb
)=>{
ensureVerificationUploadDirs();
cb(
null,
VERIFICATION_VIDEO_DIR
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
".mp4";

cb(
null,
`verification-video-${userId}-${Date.now()}${ext}`
);
}
});

const allowedMimeTypes =
[
"video/mp4",
"video/quicktime",
"video/mov",
"video/webm",
"video/3gpp",
"application/octet-stream"
];

export const verificationVideoUpload =
multer({
storage,
limits:{
fileSize:50 * 1024 * 1024
},
fileFilter:(
_req,
file,
cb
)=>{
if(
allowedMimeTypes.includes(file.mimetype) ||
file.originalname?.match(/\.(mp4|mov|webm|m4v)$/i)
){
cb(null, true);
return;
}

cb(
new Error("Only video files are allowed")
);
}
});
