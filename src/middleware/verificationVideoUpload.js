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
"video/3gp",
"video/x-m4v",
"video/mpeg",
"application/octet-stream",
""
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
const mime =
String(file.mimetype || "")
.toLowerCase();

const original =
String(file.originalname || "");

if(
!mime ||
mime.startsWith("video/") ||
allowedMimeTypes.includes(mime) ||
original.match(/\.(mp4|mov|webm|m4v|3gp)$/i)
){
cb(null, true);
return;
}

cb(
new Error("Only video files are allowed")
);
}
});
