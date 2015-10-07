Template.EditHttpConnectionBody.onRendered(function() {
	$('ul.tabs').tabs();
	$('.tooltipped').tooltip({delay: 50});
});


Template.EditHttpConnectionHeader.helpers({
	http_connectionName: function() {
		console.log(this);
	}
});

Template.EditHTTPConnectionBody.helpers({
	http_connection: function() {
		Session.get("HTTPConnectionStatus");
		c = HTTPConnections.findOne();
		console.log("CS ", c);
		return c;
	}
});
