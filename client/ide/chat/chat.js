Template.ChatBody.helpers({
	time: function() {
		return this.date.getHours()+":"+this.date.getMinutes()+":"+this.date.getSeconds();
	},
	chats: function(){
		return Chats.find({}, {sort: {date: 1}});
	},
	isAdminHighlight: function() {
		// console.log('here is username', username())

	},
	isMe: function() {
		
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