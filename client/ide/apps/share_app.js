Template.EditSingleAppBody.helpers({
	share_url: function(){
		console.log(this)
		return "http://" + Meteor.settings.public.domain + "/view/app/" + this._id;
	}
})