Template.EditMqttConnectionBody.onRendered(function() {
	$('ul.tabs').tabs();
	$('.tooltipped').tooltip({delay: 50});
});


Template.EditMqttConnectionHeader.helpers({
	connectionName: function() {
		console.log(this);
	}
});

Template.EditMqttConnectionBody.helpers({	
	connection: function() {
		Session.get("ConnectionStatus");
		c = Connections.findOne();
		console.log("CS ", c);
		return c;
	}
});
