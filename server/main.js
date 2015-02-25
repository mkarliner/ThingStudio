

  Meteor.startup(function () {
    // code to run on server at startup
	  console.log(Connexions.find({}).fetch());
	  
	  
	  
	  Meteor.publish("connexions", function(){
	  	return Connexions.find({owner: this.userId});
	  });

	  Meteor.publish("screens", function(){
	  	return Screens.find({owner: this.userId});
	  });
	  Meteor.publish("feeds", function(){
	  	return Feeds.find({owner: this.userId});
	  });
	  Meteor.publish("themes", function(){
	  	return Themes.find({owner: this.userId});
	  });
	  
	  
	  
	  

  });

