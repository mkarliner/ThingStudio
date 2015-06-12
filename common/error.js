TemplateErrors = new Mongo.Collection(null);

throwTemplateError = function(message) {
  TemplateErrors.insert({message: message});
};

RuntimeErrors = new Mongo.Collection(null);

throwRuntimeError = function(message) {
	RuntimeErrors.insert({message: message});
};

//throwError('This link has already been posted');
//throwError(error.reason);