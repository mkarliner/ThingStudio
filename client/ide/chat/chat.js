Template.ChatBody.helpers({
	time: function() {
		return this.date.getHours()+":"+this.date.getMinutes()+":"+this.date.getSeconds();
	},
	chats: function(){
		return Chats.find({}, {sort: {date: -1}});
	},
	admin: function(){
		user = Meteor.users.findOne({_id: this.userid});
				console.log("ADMIN", this.userid, user)
		if(user.roles) {
			admin =  user.roles.indexOf('admin') > -1;
		} else {
			admin = false;
		}
		return admin ? "Admin" : "Peon";
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