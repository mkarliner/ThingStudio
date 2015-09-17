Template.appViewerBody.registerElement('app-body');
// Template.appScreen.registerElement('app-screen');

Template.appViewerBody.helpers({
	screenlist: function(){
		console.log("screens")
		return Screens.find({isWidget: false})
	},
	screenparams: function(){
		console.log("SP", this);
		return {appid: this.appId, _id: this._id}
	}
});
