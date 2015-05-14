Template.ViewApp.helpers({
	screenlist: function(){
		console.log("screens")
		return Screens.find({})
	}
});