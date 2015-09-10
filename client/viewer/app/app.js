Template.appViewerBody.registerElement('app-body');

Template.appViewerBody.helpers({
	screenlist: function(){
		console.log("screens")
		return Screens.find({isWidget: false})
	}
});
