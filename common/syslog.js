SysLogs = new Mongo.Collection("syslogs");


if(Meteor.isServer) {
	Meteor.setInterval(function(){
		now = new Date();
		//purgeDate.setDate(now.getDate() - 1); //Yesterday
		purgeDate = new Date(now.getTime() - 24 * 60 * 60000)
		numremoved = SysLogs.remove({date: {$lt: purgeDate}});
		console.log("Purged syslogs, removed ", numremoved);
	
	}, 1000 * 60 * 10); //10 minute purge
	
}


Schemas.SysLog = new SimpleSchema({
	event: {
		type: String
	},
	title: {
		type: String
	},
	details: {
		type: String,
		optional: true
	},
	date: {
		type: Date,
	},
	id: {
		type: Number
	},
	appId: {
		type: Number,
		optional: true
	},
	userId: {
		type: String
	},
	count: {
		type: Number,
		optional: true,
		defaultValue: 0
	},
	userName: {
		type: String
	}
});

SysLogs.before.insert(function(userId, doc) {
	if(Meteor.isServer) {
		u =  Meteor.users.findOne({_id: userId});
		doc.userName = u? u.username : "no one";
		console.log("SL", doc);
		return doc;
	}
});

SysLogs.before.update(function(userId, doc) {
	if(Meteor.isServer) {
		u =  Meteor.users.findOne({_id: userId});
		doc.userName = u? u.username : "no one";
		console.log("SL", doc);
		return doc;
	}
});
//
// SysLogs.attachSchema(Schemas.SysLog);

SysLogs.allow({
	insert: function(userId, doc) {
		return false;
	},
	update: function(userId, doc) {
		return false;
	},
	remove: function(userId, doc) {
		return false;
	}
});