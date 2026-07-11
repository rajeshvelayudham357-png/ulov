    import {
    Broadcast
    }
    from "../models/index.js";

    import {
    notifyFemalesOnBroadcast
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
    
    
    
    
    const formatBroadcast =
    (row)=>{


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
    
    
    
    
    // GET (mobile: active only | admin: all)
    
    
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
    showAll ? {} : { active:true };


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


    res.json(
    data.map(formatBroadcast)
    );


    }catch(error){


    res.status(500)
    .json({
    message:error.message
    });


    }


    };
    
    
    
    
    // CREATE (admin)
    
    
    export const createBroadcast =
    async(req,res)=>{


    try{


    const {
    title,
    message,
    type
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


    const msg =
    await Broadcast.create({

    title:title.trim(),

    message:message.trim(),

    type:dbType,

    active:true

    });


    notifyFemalesOnBroadcast(
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
