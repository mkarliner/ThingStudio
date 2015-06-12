Errors = new Mongo.Collection(null);

throwError = function(message) {
  Errors.insert({message: message});
};

//throwError('This link has already been posted');
//throwError(error.reason);