
Schemas = {};
Credentials = {};


Meteor.startup(function(){



	Template.registerHelper("Schemas", Schemas);

	//Credentials = new Ground.Collection(null);
	//Credentials = new Meteor.Collection(null);
	Credentials = new Ground.Collection("Credentials",  {
		 cleanupLocalData: false,
		 connection: null});





	Schemas.Credentials = new SimpleSchema({
	    username: {
	        type: String,
	        label: "Username",
			defaultValue: "username",
	        max: 50
	    },
	    password: {
	        type: String,
			defaultValue: "password"
	    },
	    save: {
	        type: Boolean,
	        label: "Save?",
	    },
		connection: {
			type: String,
			autoform: {
				// omit: true
			}
		}
	});

	Credentials.attachSchema(Schemas.Credentials);
	
	Credentials.allow({
		insert: function(userId, doc) {
			return true;
		},
		update: function(userId, doc) {
			return true;
		},
		remove: function(userId, doc) {
			return true;
		}
	});
	
});


