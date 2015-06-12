getCurrentApp = function() { 
	app =  Apps.findOne({_id: Session.get("currentAppId")});
	return app;
};

getCredentials = function(){
	return Session.get("currentCredentials");
}

setCredentials = function(cred){
	 Session.set("currentCredentials", cred);
	 Session.set("authReady", true);
}


// startConnection = function(){
// 	//Called from the onReady function of connections.
// 	app = getCurrentApp();
// 	//Is there a connection defined for this app?
// 	if(app.connection) {
// 		connection = Connections.findOne({_id: app.connection})
// 		Session.set("currentConnection", connection );
// 		connect(connection);
// 	}
//
// }

getCurrentConnection = function() {
	return Session.get("currentConnection");
}

setCurrentConnection = function(conn, from){
	//console.log("Setting current connection to: ", from,  conn);
	Session.set("currentConnection", conn);
}

Template.registerHelper( 
	"gravatar", function(){
		return Gravatar.imageUrl(Meteor.user().emails[0].address);
	}
);

Template.registerHelper(
	"curr_app_name", function() {
		return Session.get("currentApp").title;
	}
);

Template.registerHelper("indexedArray",
	function(arr) {
  	  	return _.map(arr, function(value, index){
    	  return {value: value, index: index};
  });
});

Template.registerHelper("menuOps", 
	menuOps = function() {
		if ( $('#item-insert').hasClass('td-open') ) {
			//Is open
			$('main tr#item-insert').toggleClass('td-open');
			$('main div.add-new-item').removeClass('open').css({opacity: 1.0}).animate({opacity: 0.0}, 100);
			AutoForm.resetForm('insertItemForm');
		} else {
			//Is closed
			$('main tr#item-insert').toggleClass('td-open');
			$('main div.add-new-item').addClass('open').css({opacity: 0.0}).animate({opacity: 1.0}, 100);
			$('#insertItemForm input.first').focus();
		}
	}
);

Template.registerHelper("debugOps",
	debugOps = function() {
		if ( $('.debug').hasClass('debug-open') ) {
			console.log('debug is open before doing anything')
			//Is open
			$('body div.debug').toggleClass('debug-open');
			// $('main div.add-new-item').removeClass('open').css({opacity: 1.0}).animate({opacity: 0.0}, 100);
			// AutoForm.resetForm('insertItemForm');
		} else {
			//Is closed
			console.log('debug is closed before doing anything')
			$('body div.debug').toggleClass('debug-open');
			// $('main div.add-new-item').addClass('open').css({opacity: 0.0}).animate({opacity: 1.0}, 100);
			// $('#insertItemForm input.first').focus();
		}
	}
);

Template.registerHelper("deviceOrientation", function(){
	console.log("DEVO ", Session.get("deviceOrientation"))
	return Session.get("deviceOrientation");
})

Template.registerHelper("appTreeList", function(){
	return Session.get("appTreeList");
})

Template.registerHelper("themeOptions", function() {
	return;
});
