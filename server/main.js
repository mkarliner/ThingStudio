

  Meteor.startup(function () {
    // code to run on server at startup
	  console.log(Connexions.find({}).fetch());
	  
	  Meteor.publish("connexions", function(){
	  	return Connexions.find({});
	  });

	  Meteor.publish("screens", function(){
	  	return Screens.find({});
	  });
	  Meteor.publish("feeds", function(){
	  	return Feeds.find({});
	  });
	  
	  
	  

  });

