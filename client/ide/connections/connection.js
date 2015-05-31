Template.EditSingleConnectionBody.helpers({	
	connection: function() {
		Session.get("ConnectionStatus");
		c = Connections.findOne();
		console.log("CS ", c);
		return c;
	}
});