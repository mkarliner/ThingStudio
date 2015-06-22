Template.ChatBody.onRendered(function() {
	var myDiv = $(".chat-messages").get(0);
	myDiv.scrollTop = myDiv.scrollHeight;
});

Template.ChatBody.helpers({
	time: function() {
		return this.date.getHours()+":"+this.date.getMinutes()+":"+this.date.getSeconds();
	},
	chats: function(){
		return Chats.find({}, {sort: {date: 1}});
	},
	who: function(){
		
		user = Meteor.users.findOne({_id: this.userid});
				console.log("ADMIN", this.userid, user)
		admin = user.roles.indexOf('admin') > -1;
		if (user._id === Meteor.userId()) {
			return 'me';
		} else if (user.roles.indexOf)
		if(admin) {
			return 'admin'
		} else  {
			return 'other';

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