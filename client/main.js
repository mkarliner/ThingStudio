

Meteor.startup(function(){
	
	Meteor.subscribe("connexions", {
		onReady: function(){
			conn = Connexions.findOne({autoConnect: true});
			// console.log("Autoconnect: ", conn);
			if(conn) {
				connect(conn);
			}
				
			
		},
		onError: function(error){
			console.log("Connexions error", error);
		}
	});
	
	Meteor.subscribe("screens", {
		onReady: function(){

		},
		onError: function(error){
			console.log("Screens error", error);
		}
	});
	
	Meteor.subscribe("feeds", {
		onReady: function(){

		},
		onError: function(error){
			console.log("Feeds error", error);
		}
	});
	
	Meteor.subscribe("themes", {
		onReady: function(){

		},
		onError: function(error){
			console.log("Themes error", error);
		}
	});
	
	
	
	
})
