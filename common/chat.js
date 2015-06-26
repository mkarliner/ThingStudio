Chats = new Mongo.Collection("chats");


if(Meteor.isServer) {
	Meteor.setInterval(function(){
		now = new Date();
		//purgeDate.setDate(now.getDate() - 1); //Yesterday
		purgeDate = new Date(now.getTime() - 24 * 60 * 60000)
		numremoved = Chats.remove({date: {$lt: purgeDate}});
		console.log("Purged chats, removed ", numremoved);
	
	}, 1000 * 60 * 10); //10 minute purge
	
}


Schemas.Chat = new SimpleSchema({
	userid: {
		type: String,
		optional: true,
		autoform: {
			omit: true
		}
	},
	username: {
		type: String,
		optional: true,
		autoform: {
			omit: true
		}
	},
	message: {
		label: "Message",
		type: String
	},
	date: {
		type: Date,
		autoform: {
			omit: true
		},
		autoValue: function(){
			return new Date();
		}
		
	},
});

Chats.before.insert(function(userId, doc) {
	if(Meteor.isServer) {
		doc.username = Meteor.users.findOne({_id: userId}).username;
		doc.userid = userId;
		console.log("SL", doc);
		return doc;
	} 
});
//
 Chats.attachSchema(Schemas.Chat);

Chats.allow({
	insert: function(userId, doc) {
		return userId ? true : false;
	},
	update: function(userId, doc) {
		return false;
	},
	remove: function(userId, doc) {
		return false;
	}
});