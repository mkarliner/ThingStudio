Template.EditSingleHTTPConnectionBody.onRendered(function() {
	$('ul.tabs').tabs();
	$('.tooltipped').tooltip({delay: 50});
});


Template.EditSingleHTTPConnectionHeader.helpers({
	http_connectionName: function() {
		console.log(this);
	}
});

Template.EditSingleHTTPConnectionBody.helpers({	
	http_connection: function() {
		Session.get("HTTPConnectionStatus");
		c = HTTPConnections.findOne();
		console.log("CS ", c);
		return c;
	}
});