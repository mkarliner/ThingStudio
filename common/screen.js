Screens = new Mongo.Collection("screens");




Schemas = {};

Schemas.Screen = new SimpleSchema({
	title: {
		type: String,
		label: "Name",
		max: 200
	},
	html: {
		type: String,
		autoform: {
			rows: 10,
	        afFieldInput: {
	          type: 'ace',
	          class: 'editor' // optional
	          // summernote options goes here
	        }
		},
		defaultValue: "<!-- Comment -->"
	},
	owner: {
		type: String,
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
	// updatesHistory: {
// 		type: [Object],
// 		optional: true,
// 		autoValue: function() {
// 			var html = this.field("html");
// 			if (html.isSet) {
// 				if (this.isInsert) {
// 					return [{
// 						date: new Date,
// 						html: html.value
// 					}];
// 				} else {
// 					return {
// 						$push: {
// 							date: new Date,
// 							html: html.value
// 						}
// 					};
// 				}
// 			} else {
// 				this.unset();
// 			}
// 		}
// 	},
// 	'updatesHistory.$.date': {
// 		type: Date,
// 		optional: true
// 	},
// 	'updatesHistory.$.html': {
// 		type: String,
// 		optional: true
// 	},
// 	public: {
// 		type: Boolean,
// 		defaultValue: false
// 	}
//
	
});

Screens.attachSchema(Schemas.Screen);

Screens.allow({
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


