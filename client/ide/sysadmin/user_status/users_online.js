 Tracker.autorun(function() {
 	try {
 		if (!UserStatus.isMonitoring()) {
 			UserStatus.startMonitor({
 				threshold: 20000,
 				interval: 10000
 			});
 		}
 	} catch (e) {
 		console.log("Userstatus start monitor failed ", e);
 	}
 })


 Template.CurrentUsersBody.onRendered(function() {
 	$('ul.tabs').tabs();
 });

 Template.registerHelper(
 	"isAdmin", function() {
 		return (Meteor.user().roles.indexOf('admin') > -1);
 	});

 isAdmin = function() {
 	return (Meteor.user().roles.indexOf('admin') > -1);
 }

 Template.CurrentUsersBody.helpers({
 	activeUsers: function() {
 		//users =  Meteor.users.find({ "status.online": true })
 		users = Meteor.users.find({}, {
 			sort: {
 				'status.lastLogin.date': -1
 			},
 			limit: 20
 		})
 		//console.log("ONL ", users.fetch())
 		return users;
 	},
	lastActivity: function(){
		if(this.status.lastActivity) {
			return moment(this.status.lastActivity).fromNow();
		}
	},
	lastLogin: function() {
		return moment(this.status.lastLogin.date).fromNow();
	}
 });

 Template.onlineAdmins.helpers({
 	activeAdmin: function() {
 		// Only needs one admin to be available.
 		user = Meteor.users.findOne({
 			roles: "admin",
 			"status.idle": false
 		});
 		console.log("AU  ", user)
 		if (user) {
 			return user.username;
 		} else {
 			return "offline"
 		}

 	},
 	idlestatus: function() {
 		console.log("IDL", this.status);
 		return this.idle;
 	}
 });

 Template.userPill.helpers({
 		idlestatus: function() {
 			console.log("IDL", this.status);
 			return this.idle;
 		},
 		labelClass: function() {
 			if (this.status.idle == false) {
 				return "status-active"
 			} else if (this.status.online == true) {
 				return "status-online"
 			} else {
 				return "status-loggedout"
 			}
 		}
	});
