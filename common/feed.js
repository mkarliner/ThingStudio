Feeds = new Mongo.Collection("feeds");

SimpleSchema.messages({
  "uniqueFeed": "Title must be unique",
  "noPublicWildcard": "Wildcard feeds cannot be public"
});

Schemas = {};

Schemas.Feed = new SimpleSchema({
	title: {
		type: String,
		label: "Title",
		custom: function () {
			console.log(this.userId);
			//First try to find my own duplicate.
			f = Feeds.findOne({title: this.value, $or: [{owner: this.userId}, {public:true}]});
			if(!f)
			console.log("CKF ", f);
			if(f  && this.isInsert) {
				console.log("BOO")
				return "uniqueFeed";
			}
			if(f && f._id != this.docId) {
				console.log("Baa")
				return "uniqueFeed";
			}
			console.log("ALLOK")
		},
		max: 200
	},
	subscription: {
		type: String,

	},
	action: {
		type: String,
		allowedValues:[ "Update"],
		defaultValue: "Update"
	},
	owner: {
		type: String,
		index: true,
		autoform: {
			omit: true
		},
		autoValue: function(){
			if(this.isInsert) {
				return Meteor.userId();
			} else if(this.isUpsert) {
				return {$setOnInsert: Meteor.userId};
			} else {
				this.unset();
			}
		}
	},
	appId: {
		type: String,
		index: true,
		autoform: {
			omit: true
		},
	},
	public: {
		type: Boolean,
		defaultValue: false,
		custom: function(){
			if(this.field("subscription").value.indexOf("#") > 0 && this.value == true) {
				return "noPublicWildcard";
			}
			if(this.field("subscription").value.indexOf("+") > 0 && this.value == true) {
				return "noPublicWildcard";
			}
			f = Feeds.findOne({title: this.field("title").value});
			console.log("PUBCK", this.field("title"), f);
			if(f && this.value == true) {
				return "uniqueFeed";
			}
		}
	}
	
	
	
});



Feeds.attachSchema(Schemas.Feed);

Feeds.allow({
	insert: function(userId, doc) {
		return (userId && doc.owner === userId);
	},
	update: function(userId, doc) {
		return (userId && doc.owner === userId);
	},
	remove: function(userId, doc) {
		return (userId && doc.owner === userId);
	}
});