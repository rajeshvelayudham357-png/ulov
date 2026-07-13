import { sequelize } from "../config/database.js";

let userSchemaReady = false;

const columnExists =
async(columnName)=>{
try{
await sequelize.query(
`SELECT ${columnName} FROM users LIMIT 1`
);
return true;
}catch(error){
return false;
}
};

const ensureColumn =
async(
columnName,
definition
)=>{
const exists =
await columnExists(columnName);

if(exists){
return;
}

await sequelize.query(
`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`
);
};

export const ensureUserSchema =
async()=>{
if(userSchemaReady){
return;
}

try{
await ensureColumn(
"verificationAudioUrl",
"TEXT NULL"
);

await ensureColumn(
"verificationSentence",
"VARCHAR(255) NULL"
);

await ensureColumn(
"verificationVideoUrl",
"TEXT NULL"
);

await ensureColumn(
"accountStatus",
"VARCHAR(20) NOT NULL DEFAULT 'pending'"
);

userSchemaReady = true;

console.log(
"User schema ready"
);
}catch(error){
console.log(
"USER SCHEMA SYNC ERROR",
error.message
);
}
};
