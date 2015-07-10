Template.EditSingleConnectionBody.onRendered(function() {
	$('ul.tabs').tabs();
	$('.tooltipped').tooltip({delay: 50});
});


Template.EditSingleConnectionHeader.helpers({
	connectionName: function() {
		console.log(this);
	}
});

Template.EditSingleConnectionBody.helpers({	
	connection: function() {
		Session.get("ConnectionStatus");
		c = Connections.findOne();
		console.log("CS ", c);
		return c;
	}
});