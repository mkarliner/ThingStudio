

  Meteor.startup(function () {
    // code to run on server at startup
	  console.log(Connexions.find({}).fetch());
	  
	  
	  
	  Meteor.publish("connexions", function(){
	  	return Connexions.find({$or: [{owner: this.userId}, {public: true}]});
	  });

	  Meteor.publish("screens", function(){
	  	return Screens.find({$or: [{owner: this.userId}, {public: true}]});
	  });
	  Meteor.publish("feeds", function(){
	  	return Feeds.find({$or: [{owner: this.userId}, {public: true}]});
	  });
	  Meteor.publish("themes", function(){
	  	return Themes.find({$or: [{owner: this.userId}, {public: true}]});
	  });
	  
	  
	  
	  

  });

