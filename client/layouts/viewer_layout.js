Template.ViewerLayout.helpers({
	runtimeErrors: function(){
		return Session.get("runtimeErrors");
	},
	isConnected: function() {
		if ( Session.get( "ConnectionStatus" ) == true ) {
			return 'connected';
		} else {
			return 'disconnected';
		}
	}
})