

  Meteor.startup(function () {
    // code to run on server at startup
	  console.log(Connections.find({}).fetch());
	  
	  
	  
	  Meteor.publish("connections", function(){
	  	return Connections.find({$or: [{owner: this.userId}, {public: true}]});
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
	  Meteor.publish("help_pages", function(){
	  	return HelpPages.find({}, {sort: {pagenumber: 1}});
	  });
	  
	  
	  
	  

  });

