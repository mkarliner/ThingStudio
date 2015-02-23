

Meteor.startup(function(){
	
	console.log("Subscribing");
	Meteor.subscribe("connexions", {
		onReady: function(){
			console.log("Connexions ready");
			conn = Connexions.findOne({autoConnect: true});
			console.log("Autoconnect: ", conn);
			connect(conn);
		},
		onError: function(error){
			console.log("Connexions error", error);
		}
	});
	
	Meteor.subscribe("screens", {
		onReady: function(){
			console.log("Screens ready");
		},
		onError: function(error){
			console.log("Screens error", error);
		}
	});
	
	Meteor.subscribe("feeds", {
		onReady: function(){
			console.log("Feeds ready");
		},
		onError: function(error){
			console.log("Feeds error", error);
		}
	});
	
	
})
