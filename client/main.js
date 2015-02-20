Meteor.startup(function(){
	
	console.log("Subscribing");
	Meteor.subscribe("connexions", {
		onReady: function(){
			console.log("Connexions ready");
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
	
})
