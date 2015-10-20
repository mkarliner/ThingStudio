Template.EditHttpConnectionBody.onRendered(function() {
	$('ul.tabs').tabs();
	// $('.tooltipped').tooltip({delay: 50});
});


// Template.EditHttpConnectionHeader.helpers({
// 	connectionName: function() {
// 		console.log(this);
// 	}
// });
//
// Template.EditHttpConnectionBody.helpers({
// 	connection: function() {
// 		Session.get("ConnectionStatus");
// 		c = Connections.findOne();
// 		console.log("CS ", c);
// 		return c;
// 	}
// });
