export class BattleFeatureDisabledError extends Error {
  constructor(message = "Gift Battles are not available") {
    super(message);
    this.name = "BattleFeatureDisabledError";
    this.statusCode = 403;
  }
}

export class BattleConflictError extends Error {
  constructor(message = "Battle conflict") {
    super(message);
    this.name = "BattleConflictError";
    this.statusCode = 409;
  }
}

export class BattleUserInCallError extends Error {
  constructor(message = "Finish your current call before joining a battle") {
    super(message);
    this.name = "BattleUserInCallError";
    this.statusCode = 409;
  }
}

export class BattleAgoraAuthorizationError extends Error {
  constructor(message = "Battle membership required") {
    super(message);
    this.name = "BattleAgoraAuthorizationError";
    this.statusCode = 403;
  }
}

export class BattleAgoraNotFoundError extends Error {
  constructor(message = "Battle not found") {
    super(message);
    this.name = "BattleAgoraNotFoundError";
    this.statusCode = 404;
  }
}

export class BattleAgoraUnavailableError extends Error {
  constructor(message = "Battle is not available for audio") {
    super(message);
    this.name = "BattleAgoraUnavailableError";
    this.statusCode = 400;
  }
}
