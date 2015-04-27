// UI.registerHelper('messagelist', function() {
// 	// extract boolean value from data context. the data context is
// 	// always an object -- in this case it's a wrapped boolean object.
// 	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean
// 	var feedname = this.valueOf();
// 
// 	valid = checkFeed(feedname);
// 	
// 	msgs = Messages.find({
// 		feed: feedname
// 	});
// 	if(valid) {
// 		return Template._messagelist_list;
// 	} else {
// 		Template._messagelist_noop;
// 	}
// 	
// });


Template.messagelist.helpers({
	messages_list: function(feedname) {
		// console.log("Feednamexxx", feedname);
		msgs =  Messages.find({ feed: feedname}).fetch();
		// console.log("MESSAGES: " , msgs);
		return msgs;
	}
})
