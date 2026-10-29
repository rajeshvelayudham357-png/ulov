import {
    Favorite,
    User
   } from "../models/index.js";
import {
Op
} from "sequelize";

import {
filterBlockedUsers,
getBlockedPeerIds
} from "../services/block.service.js";
import { attachCreatorCallRates } from "../services/callRate.service.js";
import { getLastSeenAtMap } from "../services/userPresence.service.js";
   
   
   
   // ADD / REMOVE FAVORITE
   
   export const toggleFavorite =
   async(req,res)=>{
   
   
   try{
   
   
   const {
    userId,
    favoriteUserId
   }=req.body;
   
   
   
   const existing =
   await Favorite.findOne({
   
   where:{
    userId,
    favoriteUserId
   }
   
   });
   
   
   
   if(existing){
   
   
   await existing.destroy();
   
   
   return res.json({
   
   favorite:false,
   
   message:"Removed"
   
   });
   
   
   }
   
   const user =
await User.findByPk(userId);


const favoriteUser =
await User.findByPk(favoriteUserId);



if(
 !user ||
 !favoriteUser
){

 return res.status(404).json({

  message:
  "User not found"

 });

}
   
   
   await Favorite.create({
   
   userId,
   
   favoriteUserId
   
   });
   
   
   
   return res.json({
   
   favorite:true,
   
   message:"Added"
   
   });
   
   
   
   
   }catch(error){
   
   
   return res.status(500).json({
   
   message:error.message
   
   });
   
   
   }
   
   
   };
   
   
   
   
   const getDisplayName =
   (user)=>{
   
   const name =
   user.name?.trim();
   
   const username =
   user.username?.trim();
   
   const nickname =
   user.nickname?.trim();
   
   if(
   name &&
   name !== "New User"
   ){
   return name;
   }
   
   if(username){
   return username;
   }
   
   if(nickname){
   return nickname;
   }
   
   return name || "User";
   
   };
   
   
   
   // GET MALES WHO FAVOURITED A FEMALE
   
   
   export const getFemaleFans =
   async(req,res)=>{
   
   
   try{
   
   
   const {
   femaleUserId
   }=req.params;

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

   const offset =
   (page - 1) * limit;
   
   
   
   const female =
   await User.findByPk(
   femaleUserId,
   {
   attributes:["id","gender"]
   }
   );
   
   
   
   if(!female){
   
   return res.status(404).json({
   
   message:"User not found"
   
   });
   
   }

   const blockedIds =
   await getBlockedPeerIds(femaleUserId);

   const blockedFanIds =
   [...blockedIds];

   const fanWhere = {};

   if(blockedFanIds.length > 0){
   fanWhere.id = {
    [Op.notIn]:blockedFanIds
   };
   }

   const favoriteWhere = {
   favoriteUserId:femaleUserId
   };
   
   
   const [
   favorites,
   total
   ]=
   await Promise.all([

   Favorite.findAll({
   
   where:favoriteWhere,
   
   
   include:[
   {
   model:User,
   as:"fan",
   required:true,
   where:fanWhere,
   attributes:[
   "id",
   "username",
   "name",
   "nickname",
   "avatar",
   "online",
   "gender",
   "verified"
   ]
   }
   ],
   
   
   order:[
   ["createdAt","DESC"]
   ],

   limit,
   offset
   
   
   }),

   Favorite.count({
   where:favoriteWhere,
   include:[
   {
   model:User,
   as:"fan",
   required:true,
   where:fanWhere
   }
   ]
   })

   ]);
   
   
   
   const fans =
   favorites
   .filter(
   item=>item.fan
   )
   .map(
   item=>({
   
   id:item.fan.id,
   
   username:item.fan.username,
   
   name:
   getDisplayName(item.fan),
   
   avatar:item.fan.avatar,
   
   online:item.fan.online,
   
   gender:item.fan.gender,
   
   verified:item.fan.verified,
   
   favoritedAt:item.createdAt
   
   })
   );
   
   
   
   return res.json({
   
   fans,
   
   total,

   page,

   limit,

   hasMore:
   offset + fans.length < total
   
   });
   
   
   
   
   }catch(error){
   
   
   return res.status(500).json({
   
   message:error.message
   
   });
   
   
   }
   
   
   
   };
   
   
   
   // GET FAVORITES
   
   
   export const getFavorites =
   async(req,res)=>{
   
   
   try{
   
   
   const {
    userId
   }=req.params;

   const paged =
   req.query.limit !== undefined ||
   req.query.offset !== undefined;

   if (paged) {
   const limit =
   Math.min(
   50,
   Math.max(1, Number(req.query.limit) || 20)
   );

   const offset =
   Math.max(0, Number(req.query.offset) || 0);

   const blockedIds =
   [...await getBlockedPeerIds(userId)];

   const include = [
   {
   model: User,
   as: "profile",
   required: true,
   ...(blockedIds.length
   ? { where: { id: { [Op.notIn]: blockedIds } } }
   : {})
   }
   ];

   const { rows, count } =
   await Favorite.findAndCountAll({
   where: { userId },
   include,
   order: [["createdAt", "DESC"]],
   limit,
   offset,
   distinct: true
   });

   const profilesWithRates = await attachCreatorCallRates(
   rows.map((item) => item.profile)
   );

   const profileRateById = new Map(
   profilesWithRates.map((profile) => [Number(profile.id), profile])
   );

   const lastSeenById = await getLastSeenAtMap(
   rows.map((item) => item.profile)
   );

   const favoritesWithRates =
   rows.map((item) => {
   const profile =
   profileRateById.get(Number(item.profile.id)) ??
   item.profile.toJSON?.() ??
   item.profile;

   return {
   ...item.toJSON(),
   profile: {
   ...profile,
   lastSeenAt: lastSeenById.get(Number(item.profile.id)) ?? null
   }
   };
   });

   return res.json({
   favorites: favoritesWithRates,
   limit,
   offset,
   total: count,
   hasMore: offset + favoritesWithRates.length < count
   });
   }
   
   
   
   const favorites =
   await Favorite.findAll({
   
   where:{
    userId
   },
   
   
   include:[
   {
    model:User,
    as:"profile"
   }
   ]
   
   
   });

   const blockedIds =
   await getBlockedPeerIds(userId);

   const visibleFavorites =
   favorites.filter(
   item=>
   item.profile &&
   !blockedIds.has(Number(item.profile.id))
   );

   const profilesWithRates = await attachCreatorCallRates(
   visibleFavorites.map((item) => item.profile)
   );

   const profileRateById = new Map(
   profilesWithRates.map((profile) => [Number(profile.id), profile])
   );

   const lastSeenById = await getLastSeenAtMap(
   visibleFavorites.map((item) => item.profile)
   );

   const favoritesWithRates =
   visibleFavorites.map((item) => {
   const profile =
   profileRateById.get(Number(item.profile.id)) ??
   item.profile.toJSON?.() ??
   item.profile;

   return {
   ...item.toJSON(),
   profile: {
   ...profile,
   lastSeenAt: lastSeenById.get(Number(item.profile.id)) ?? null
   },
   };
   });
   
   
   
   res.json({
   
   favorites:favoritesWithRates
   
   });
   
   
   
   
   }catch(error){
   
   
   res.status(500).json({
   
   message:error.message
   
   });
   
   
   }
   
   
   
   };