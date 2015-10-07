Template.NewHttpConnectionHeader.helpers({
	http_connectionName: function() {
		console.log(this);
	}
});

Template.NewHttpConnectionBody.onRendered(function() {
	$('ul.tabs').tabs();
	$('.tooltipped').tooltip({delay: 50});
});

Template.NewHttpConnectionBody.helpers({
	http_connection: function() {
		Session.get("HTTPConnectionStatus");
		c = HTTPConnections.findOne();
		console.log("CS ", c);
		return c;
	}
});
