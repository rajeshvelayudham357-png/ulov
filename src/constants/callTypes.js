export const DB_CALL_TYPES = [
"voice",
"video"
];

export const normalizeCallTypeForDb =
(type)=>{

const value =
String(
type ?? "video"
).toLowerCase();

if(
value === "audio" ||
value === "voice"
){
return "voice";
}

return "video";

};

export const normalizeCallTypeForClient =
(type)=>{

const value =
normalizeCallTypeForDb(type);

return value === "voice"
?
"audio"
:
"video";

};
