Template.ChatBody.onRendered(function() {
	var myDiv = $(".chat-messages").get(0);
	myDiv.scrollTop = myDiv.scrollHeight;
});

Template.ChatHeader.helpers({
	onlineUsers: function() {
  	  users =  Meteor.users.find({ "status.online": true })
		console.log("ONL ", users.fetch())
		return users;
	},
	status: function(){
		console.log(this.status)
		return this.status.idle ? "idle" : "active";
	}
})

Template.ChatBody.helpers({
	time: function() {
		if(this.date) {
			return this.date.getHours()+":"+this.date.getMinutes()+":"+this.date.getSeconds();
		} else {
			return null;
		}
		
	},
	chats: function(){
		return Chats.find({}, {sort: {date: 1}});
	},
	who: function(){	
		user = Meteor.users.findOne({_id: this.userid});
		if (user && user._id === Meteor.userId()) {
			return 'me';
		} else if (user && user.roles && user.roles.indexOf('admin') > -1) {
			return "admin";
		} else {
			return "other"
		}

	}
});

Template.ChatBox.helpers({
	time: function() {
		return this.date.getHours()+":"+this.date.getMinutes()+":"+this.date.getSeconds();
	},
	chats: function(){
		return Chats.find({}, {sort: {date: -1}});
	}
})