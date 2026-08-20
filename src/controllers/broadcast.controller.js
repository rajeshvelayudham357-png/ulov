    import { Op } from "sequelize";

    import {
    Broadcast,
    User
    }
    from "../models/index.js";

    import {
    notifyFemalesOnBroadcast,
    notifyMalesOnBroadcast,
    notifyAllUsersOnBroadcast,
    notifySingleUserOnBroadcast
    } from "../services/notificationPush.service.js";
    
    
    
    
    const TYPE_TO_DB = {
    
    general:"info",
    
    offer:"offer",
    
    creator:"info",
    
    alert:"warning",
    
    info:"info",
    
    warning:"warning"
    
    };
    
    
    
    
    const TYPE_FROM_DB = {
    
    info:"general",
    
    offer:"offer",
    
    warning:"alert"
    
    };


    const AUDIENCE_LABELS = {
    female:"All Females",
    male:"All Males",
    all:"All Users",
    individual:"Individual"
    };


    const normalizeAudience =
    (value)=>{
    const audience =
    String(value || "female").trim().toLowerCase();

    if(
    audience === "male" ||
    audience === "all" ||
    audience === "female"
    ){
    return audience;
    }

    return "female";
    };


    const getDisplayName =
    (user)=>{
    if(
    !user
    ){
    return "Unknown";
    }

    const data =
    user.toJSON ?
    user.toJSON() :
    user;

    return (
    data.nickname ||
    (
    data.name &&
    data.name !== "New User"
    ?
    data.name
    :
    null
    ) ||
    data.username ||
    data.publicUserId ||
    data.phone ||
    `User ${data.id}`
    );
    };
    
    
    
    
    const formatBroadcast =
    (row, recipient = null)=>{


    const data =
    row.toJSON ?
    row.toJSON() :
    row;


    return {

    id:data.id,

    title:data.title,

    message:data.message,

    type:TYPE_FROM_DB[data.type] || data.type || "general",

    dbType:data.type,

    active:data.active,

    targetUserId:data.targetUserId ?? null,

    recipientName:recipient ? getDisplayName(recipient) : null,

    recipientPhone:recipient?.phone || null,

    scope:data.targetUserId ?
    "individual" :
    (data.targetAudience || "female"),

    audience:data.targetUserId ?
    "individual" :
    normalizeAudience(data.targetAudience),

    audienceLabel:data.targetUserId ?
    AUDIENCE_LABELS.individual :
    (AUDIENCE_LABELS[normalizeAudience(data.targetAudience)] || AUDIENCE_LABELS.female),

    createdAt:data.createdAt,

    updatedAt:data.updatedAt,

    time:data.createdAt ?
    new Date(data.createdAt).toLocaleString(
    "en-IN",
    {
    hour:"2-digit",
    minute:"2-digit",
    day:"2-digit",
    month:"short"
    }
    ) :
    ""

    };


    };
    
    
    
    
    // GET (mobile: active global only | admin: all)
    
    
    export const getBroadcasts =
    async(req,res)=>{


    try{


    const showAll =
    req.query.all === "true";

    const page =
    Math.max(
    1,
    parseInt(req.query.page,10) || 1
    );

    const limit =
    Math.min(
    50,
    Math.max(
    1,
    parseInt(req.query.limit,10) || 20
    )
    );

    const usePagination =
    req.query.page !== undefined ||
    req.query.limit !== undefined;

    const offset =
    (page - 1) * limit;

    const whereClause =
    showAll ?
    {} :
    {
    active:true,
    targetUserId:null
    };


    if(usePagination){

    const [
    data,
    total
    ]=
    await Promise.all([

    Broadcast.findAll({

    where:whereClause,

    order:[
    ["createdAt","DESC"]
    ],

    limit,
    offset

    }),

    Broadcast.count({
    where:whereClause
    })

    ]);

    return res.json({
    broadcasts:data.map(formatBroadcast),
    total,
    page,
    limit,
    hasMore:
    offset + data.length < total
    });

    }


    const data =
    await Broadcast.findAll({

    where:whereClause,

    order:[
    ["createdAt","DESC"]
    ]

    });

    const targetUserIds = [
    ...new Set(
    data
    .map((row)=>row.targetUserId)
    .filter((value)=>Number.isFinite(Number(value)))
    .map((value)=>Number(value))
    )
    ];

    let recipientMap = {};

    if(
    showAll &&
    targetUserIds.length
    ){
    const recipients =
    await User.findAll({
    where:{
    id:{
    [Op.in]:targetUserIds
    }
    },
    attributes:[
    "id",
    "name",
    "nickname",
    "username",
    "phone"
    ]
    });

    recipientMap =
    Object.fromEntries(
    recipients.map((user)=>[
    user.id,
    user.toJSON()
    ])
    );
    }


    res.json(
    data.map((row)=>
    formatBroadcast(
    row,
    row.targetUserId ?
    recipientMap[row.targetUserId] :
    null
    )
    )
    );


    }catch(error){


    res.status(500)
    .json({
    message:error.message
    });


    }


    };
    
    
    
    
    // CREATE (admin - all females)
    
    
    export const createBroadcast =
    async(req,res)=>{


    try{


    const {
    title,
    message,
    type,
    audience
    }=req.body;


    if(
    !title?.trim() ||
    !message?.trim()
    ){


    return res.status(400)
    .json({
    message:"Title and message are required"
    });


    }


    const dbType =
    TYPE_TO_DB[type] ||
    "info";

    const targetAudience =
    normalizeAudience(audience);


    const msg =
    await Broadcast.create({

    title:title.trim(),

    message:message.trim(),

    type:dbType,

    active:true,

    targetUserId:null,

    targetAudience

    });


    const notifyHandler =
    targetAudience === "male"
    ? notifyMalesOnBroadcast
    : targetAudience === "all"
    ? notifyAllUsersOnBroadcast
    : notifyFemalesOnBroadcast;

    notifyHandler(
    formatBroadcast(msg)
    ).catch(
    error=>{
    console.log(
    "BROADCAST NOTIFY ERROR",
    error.message
    );
    }
    );


    res.status(201)
    .json(
    formatBroadcast(msg)
    );


    }catch(error){


    res.status(500)
    .json({
    message:error.message
    });


    }


    };


    export const listBroadcastUsers =
    async(req,res,genderOverride = null)=>{

    try{

    const search =
    String(req.query.search || "")
    .trim();

    const genderFilter =
    String(
    genderOverride ||
    req.query.gender ||
    "female"
    ).trim().toLowerCase();

    const where = {
    gender:{
    [Op.in]:
    genderFilter === "male"
    ? ["Male","male"]
    : ["Female","female"]
    }
    };

    if(search){
    where[Op.and] = [
    {
    [Op.or]:[
    { name:{ [Op.like]:`%${search}%` } },
    { nickname:{ [Op.like]:`%${search}%` } },
    { username:{ [Op.like]:`%${search}%` } },
    { publicUserId:{ [Op.like]:`%${search}%` } },
    { phone:{ [Op.like]:`%${search}%` } },
    { email:{ [Op.like]:`%${search}%` } }
    ]
    }
    ];
    }

    const users =
    await User.findAll({
    where,
    attributes:[
    "id",
    "publicUserId",
    "name",
    "nickname",
    "username",
    "phone",
    "email",
    "accountStatus",
    "online",
    "gender"
    ],
    order:[
    ["name","ASC"],
    ["id","ASC"]
    ],
    limit:200
    });

    res.json(
    users.map((user)=>{
    const data =
    user.toJSON();

    return {
    id:data.id,
    publicUserId:data.publicUserId,
    displayName:getDisplayName(data),
    phone:data.phone,
    email:data.email,
    accountStatus:data.accountStatus,
    online:Boolean(data.online),
    gender:data.gender
    };
    })
    );

    }catch(error){

    res.status(500)
    .json({
    message:error.message
    });

    }

    };


    export const listBroadcastFemales =
    async(req,res)=>{
    return listBroadcastUsers(req,res,"female");
    };


    export const listBroadcastMales =
    async(req,res)=>{
    return listBroadcastUsers(req,res,"male");
    };


    export const createIndividualBroadcast =
    async(req,res)=>{

    try{

    const {
    title,
    message,
    type,
    userId
    }=req.body;

    const targetUserId =
    Number(userId);

    if(
    !title?.trim() ||
    !message?.trim()
    ){
    return res.status(400)
    .json({
    message:"Title and message are required"
    });
    }

    if(
    !Number.isFinite(targetUserId)
    ){
    return res.status(400)
    .json({
    message:"Please select a user"
    });
    }

    const user =
    await User.findByPk(
    targetUserId,
    {
    attributes:[
    "id",
    "name",
    "nickname",
    "username",
    "phone",
    "gender"
    ]
    }
    );

    if(
    !user
    ){
    return res.status(404)
    .json({
    message:"User not found"
    });
    }

    const dbType =
    TYPE_TO_DB[type] ||
    "info";

    const msg =
    await Broadcast.create({
    title:title.trim(),
    message:message.trim(),
    type:dbType,
    active:true,
    targetUserId,
    targetAudience:"individual"
    });

    const notifyResult =
    await notifySingleUserOnBroadcast(
    formatBroadcast(msg),
    targetUserId
    );

    const recipient =
    user.toJSON();

    res.status(201)
    .json({
    ...formatBroadcast(
    msg,
    recipient
    ),
    notified:notifyResult.notified
    });

    }catch(error){

    const status =
    error.message === "User not found" ?
    404 :
    500;

    res.status(status)
    .json({
    message:error.message
    });

    }

    };
